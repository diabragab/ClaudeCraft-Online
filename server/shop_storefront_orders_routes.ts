// Player-facing storefront orders surface (Phase 4): "my orders" over the
// EXISTING Phase 3 ShopOrdersService. The admin surface
// (server/shop_orders_routes.ts, /admin/api/shop/orders) stays operator-only
// and untouched by this module (see SHOP_SYSTEM.md's Phase 3 scope decision);
// this is the separately-permissioned player create/read path that decision
// called for. Every handler is a thin wrapper: the accountId is ALWAYS the
// authenticated caller's own (`ctxAccountId(ctx)`), never client-supplied, and
// every read is ownership-checked before it is returned. Zero duplicated
// business logic: creation, the state machine, and stock reservation all run
// through the exact same ShopOrdersService.createOrder used by the admin
// surface.

import {
  accountAndScopeForToken,
  accountById,
  type AccountModerationStatus,
  moderationStatusForAccount,
  pool,
  type TokenScope,
} from './db';
import { ctxAccountId } from './http/context';
import { HttpError } from './http/errors';
import { withBody } from './http/middleware/body';
import { requireAccount } from './http/middleware/require_account';
import { requireOwned } from './http/middleware/require_owned';
import { array, enum_, num, object, optional, str } from './http/schema';
import type { Ctx, RouteDef } from './http/types';
import { json } from './http_util';
import {
  type ShopAccountLookup,
  type ShopOrderDetail,
  type ShopOrderErrorCode,
  ShopOrdersService,
  shopOrderDetailJson,
  shopOrderJson,
} from './shop_orders';
import { PgShopOrdersDb } from './shop_orders_db';

// ---------------------------------------------------------------------------
// The service singleton. Same construction shape as server/shop_orders_routes.ts
// (a second instance over the SAME real Postgres-backed dependencies; the
// business logic, not just the class, is what is reused). The setter lets a
// unit test drive the routes with an in-memory fake.
// ---------------------------------------------------------------------------

const PG_ACCOUNT_LOOKUP: ShopAccountLookup = {
  async accountExists(id: number) {
    const account = await accountById(id);
    return account ? { id: account.id, username: account.username } : null;
  },
};

const REAL_SERVICE = new ShopOrdersService(new PgShopOrdersDb(pool), PG_ACCOUNT_LOOKUP);
let ordersService = REAL_SERVICE;

export function setStorefrontOrdersServiceForTests(service: ShopOrdersService): void {
  ordersService = service;
}

export function resetStorefrontOrdersServiceForTests(): void {
  ordersService = REAL_SERVICE;
}

// ---------------------------------------------------------------------------
// Auth guards (server/http/middleware/require_account.ts): 'active' for the
// mutating create, 'read' for the two list/get reads. The lookup/moderation
// reads are wrapped behind a swappable bundle (mirrors
// server/http/middleware/bearer_active_guard.ts's getDb() pattern) so a unit
// test can drive the guard without a real Postgres pool: each closure below
// re-reads `authDb` per call, so the swap takes effect on the NEXT request
// even though requireAccount() itself resolves its deps once at construction.
// ---------------------------------------------------------------------------

export interface StorefrontOrdersAuthDb {
  accountAndScopeForToken(token: string): Promise<{ accountId: number; scope: TokenScope } | null>;
  moderationStatusForAccount(accountId: number): Promise<AccountModerationStatus>;
}

const REAL_AUTH_DB: StorefrontOrdersAuthDb = { accountAndScopeForToken, moderationStatusForAccount };
let authDb = REAL_AUTH_DB;

export function setStorefrontOrdersAuthDbForTests(db: StorefrontOrdersAuthDb): void {
  authDb = db;
}

export function resetStorefrontOrdersAuthDbForTests(): void {
  authDb = REAL_AUTH_DB;
}

const activeAccount = requireAccount({
  scope: 'active',
  lookupToken: (token) => authDb.accountAndScopeForToken(token),
  moderationStatus: (accountId) => authDb.moderationStatusForAccount(accountId),
});
const readAccount = requireAccount({
  scope: 'read',
  lookupToken: (token) => authDb.accountAndScopeForToken(token),
  moderationStatus: (accountId) => authDb.moderationStatusForAccount(accountId),
});

const SHOP_ORDER_RESOURCE = 'shop_order';

// The BOLA owner loader for GET /api/shop/orders/:id: account-scoped (id AND
// accountId), so a missing order and someone else's order are indistinguishable
// 404s (anti-enumeration), mirroring server/characters.ts's requireOwnedCharacter
// and server/maps_routes.ts's requireOwnedMap. The body carries the shop domain's
// own stable code (shop.not_found) rather than a legacy-parity prose-only body,
// since this route has no legacy twin to match.
const requireOwnedOrder = requireOwned<ShopOrderDetail>({
  resource: SHOP_ORDER_RESOURCE,
  param: 'id',
  load: async (accountId, id) => {
    const order = await ordersService.getOrder(id);
    return order !== null && order.accountId === accountId ? order : null;
  },
  notFoundBody: { error: 'not found', code: 'shop.not_found' },
});

/** The owned order row requireOwnedOrder stashed on ctx.state. */
function ownedOrder(ctx: Ctx): ShopOrderDetail {
  return ctx.state.get(SHOP_ORDER_RESOURCE) as ShopOrderDetail;
}

// ---------------------------------------------------------------------------
// Request-shape schemas. No accountId field anywhere: the caller's own
// account is always the one ctxAccountId(ctx) resolves from the bearer token.
// ---------------------------------------------------------------------------

const NOTE_MAX_LEN = 500;
const orderCurrencyEnum = enum_(['gold', 'claudium', 'usd']);
const orderStatusEnum = enum_(['pending', 'paid', 'fulfilled', 'cancelled', 'refunded']);
const sortDirEnum = enum_(['asc', 'desc']);

const orderItemSchema = object({
  productId: num({ int: true, min: 1 }),
  quantity: num({ int: true, min: 1, max: 9999 }),
});

const createOrderBodySchema = object({
  currency: orderCurrencyEnum,
  items: array(orderItemSchema, { minLength: 1, maxLength: 50 }),
  note: optional(str({ maxLength: NOTE_MAX_LEN }), ''),
});

const listMyOrdersQuerySchema = object({
  page: optional(num({ int: true, min: 1 }), 1),
  limit: optional(num({ int: true, min: 1, max: 100 }), 20),
  status: optional(orderStatusEnum),
  sort: optional(enum_(['createdAt', 'updatedAt', 'totalAmount']), 'createdAt'),
  dir: optional(sortDirEnum, 'desc'),
});

/** Maps a domain-rule rejection to the shared shop HttpError codes (see error_codes.ts). */
function shopOrderError(error: ShopOrderErrorCode): HttpError {
  if (error === 'account_not_found' || error === 'product_not_found' || error === 'not_found') {
    return new HttpError(404, 'shop.not_found');
  }
  if (error === 'not_tracked' || error === 'insufficient_stock') {
    return new HttpError(400, 'shop.out_of_stock');
  }
  if (error === 'invalid_transition') {
    return new HttpError(400, 'shop.invalid_status_transition');
  }
  return new HttpError(400, 'shop.invalid_input');
}

// ---------------------------------------------------------------------------
// Handlers.
// ---------------------------------------------------------------------------

/** POST /api/shop/orders: place an order as the authenticated caller. */
async function createHandler(ctx: Ctx): Promise<void> {
  const decoded = createOrderBodySchema.decode(ctx.body ?? {});
  if (!decoded.ok) throw decoded;
  const accountId = ctxAccountId(ctx);
  const result = await ordersService.createOrder({ ...decoded.value, accountId }, null);
  if (!result.ok) throw shopOrderError(result.error);
  json(ctx.res, 200, shopOrderDetailJson(result.order));
}

/** GET /api/shop/orders: the authenticated caller's own order history. */
async function listHandler(ctx: Ctx): Promise<void> {
  const decoded = listMyOrdersQuerySchema.decode(ctx.query);
  if (!decoded.ok) throw decoded;
  const accountId = ctxAccountId(ctx);
  const { rows, total } = await ordersService.listOrders({
    ...decoded.value,
    q: '',
    accountId,
  });
  json(ctx.res, 200, {
    rows: rows.map(shopOrderJson),
    total,
    page: decoded.value.page,
    limit: decoded.value.limit,
  });
}

/** GET /api/shop/orders/:id: one of the caller's OWN orders (loaded + authorized by requireOwnedOrder). */
async function getHandler(ctx: Ctx): Promise<void> {
  json(ctx.res, 200, shopOrderDetailJson(ownedOrder(ctx)));
}

// ---------------------------------------------------------------------------
// The route table. registry.ts spreads this into apiRoutes. Registry-only:
// no legacy ladder twin (a brand-new player-facing surface).
// ---------------------------------------------------------------------------

export const routes: RouteDef[] = [
  {
    method: 'POST',
    path: '/api/shop/orders',
    surface: 'api',
    middleware: [activeAccount, withBody()],
    handler: createHandler,
  },
  {
    method: 'GET',
    path: '/api/shop/orders',
    surface: 'api',
    middleware: [readAccount],
    handler: listHandler,
  },
  {
    method: 'GET',
    path: '/api/shop/orders/:id',
    surface: 'api',
    middleware: [readAccount, requireOwnedOrder],
    meta: { requireOwned: { kind: 'shop_order', ownerScope: 'account' } },
    handler: getHandler,
  },
];
