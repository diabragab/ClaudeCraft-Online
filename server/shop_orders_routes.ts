// Admin-only surface for shop orders (Phase 3: back-office order entry and
// fulfillment over the Phase 1/2 catalog; no payment gateway or customer
// storefront yet, see shop_orders.ts's header). Every route is gated by
// requireAdmin (server/admin.ts, the SAME instance every other admin-surface
// route mounts): 'shop.read' for the reads, 'shop.manage' for every write,
// the same two permissions Categories/Products/Inventory already use (no new
// permission needed). The business rules and the state machine stay in
// shop_orders.ts (zero HTTP); this module owns the RouteDefs, the
// request-shape schemas, and the service singleton wired to Postgres.

import { requireAdmin } from './admin';
import { accountById, pool } from './db';
import { adminOk } from './http/admin_envelope';
import { HttpError } from './http/errors';
import { withBody } from './http/middleware/body';
import {
  ADMIN_META,
  adminIdentityOf,
  adminTargetId,
  adminTargetMeta,
  requireAdminTarget,
} from './http/middleware/require_admin';
import { array, enum_, type Infer, num, object, optional, str } from './http/schema';
import type { Ctx, RouteDef } from './http/types';
import {
  type ShopAccountLookup,
  type ShopOrderErrorCode,
  ShopOrdersService,
  shopOrderDetailJson,
  shopOrderJson,
} from './shop_orders';
import { PgShopOrdersDb } from './shop_orders_db';

// ---------------------------------------------------------------------------
// The service singleton. Construction is pure; the setter lets a unit test
// drive the routes with an in-memory fake (see shop_products_routes.ts).
// ---------------------------------------------------------------------------

/** Wraps the existing server/db.ts accountById read (never new account SQL). */
const PG_ACCOUNT_LOOKUP: ShopAccountLookup = {
  async accountExists(id: number) {
    const account = await accountById(id);
    return account ? { id: account.id, username: account.username } : null;
  },
};

const REAL_SHOP_ORDERS_SERVICE = new ShopOrdersService(new PgShopOrdersDb(pool), PG_ACCOUNT_LOOKUP);
let ordersServiceInstance: ShopOrdersService = REAL_SHOP_ORDERS_SERVICE;

/** Override the shop orders service with a fake (test-only). */
export function setShopOrdersServiceForTests(service: ShopOrdersService): void {
  ordersServiceInstance = service;
}

/** Restore the real Postgres-backed shop orders service (test-only). */
export function resetShopOrdersServiceForTests(): void {
  ordersServiceInstance = REAL_SHOP_ORDERS_SERVICE;
}

function ordersService(): ShopOrdersService {
  return ordersServiceInstance;
}

// ---------------------------------------------------------------------------
// Request-shape schemas.
// ---------------------------------------------------------------------------

const NOTE_MAX_LEN = 500;
const orderStatusEnum = enum_(['pending', 'paid', 'fulfilled', 'cancelled', 'refunded']);
const orderCurrencyEnum = enum_(['gold', 'claudium', 'usd']);
const orderSortEnum = enum_(['createdAt', 'updatedAt', 'totalAmount']);
const sortDirEnum = enum_(['asc', 'desc']);

const orderItemSchema = object({
  productId: num({ int: true, min: 1 }),
  quantity: num({ int: true, min: 1, max: 9999 }),
});

const listOrdersQuerySchema = object({
  page: optional(num({ int: true, min: 1 }), 1),
  limit: optional(num({ int: true, min: 1, max: 100 }), 20),
  q: optional(str({ maxLength: 64 }), ''),
  status: optional(orderStatusEnum),
  accountId: optional(num({ int: true, min: 1 })),
  sort: optional(orderSortEnum, 'createdAt'),
  dir: optional(sortDirEnum, 'desc'),
});

const createOrderBodySchema = object({
  accountId: num({ int: true, min: 1 }),
  currency: orderCurrencyEnum,
  items: array(orderItemSchema, { minLength: 1, maxLength: 50 }),
  note: optional(str({ maxLength: NOTE_MAX_LEN }), ''),
});

const updateStatusBodySchema = object({
  status: orderStatusEnum,
  note: optional(str({ maxLength: NOTE_MAX_LEN }), ''),
});

const noteOnlyBodySchema = object({
  note: optional(str({ maxLength: NOTE_MAX_LEN }), ''),
});

export type ListOrdersQuery = Infer<typeof listOrdersQuerySchema>;
export type CreateOrderBody = Infer<typeof createOrderBodySchema>;
export type UpdateOrderStatusBody = Infer<typeof updateStatusBodySchema>;
export type NoteOnlyBody = Infer<typeof noteOnlyBodySchema>;

/**
 * Map a domain-rule rejection to the shared shop HttpError codes (see
 * error_codes.ts). The admin envelope never spreads HttpError params into the
 * response body, so the specific ShopOrderErrorCode reason and the failing
 * productId (when present) are not sent to the client; the reads
 * (getOrder/listOrders) surface enough for an operator to see WHICH item.
 */
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

/** GET /admin/api/shop/orders: paginated, searchable, filterable, sortable list. */
async function listHandler(ctx: Ctx): Promise<void> {
  const decoded = listOrdersQuerySchema.decode(ctx.query);
  if (!decoded.ok) throw decoded;
  const { rows, total } = await ordersService().listOrders(decoded.value);
  adminOk(ctx.res, {
    rows: rows.map(shopOrderJson),
    total,
    page: decoded.value.page,
    limit: decoded.value.limit,
  });
}

/** POST /admin/api/shop/orders: create an order (reserves stock for its items). */
async function createHandler(ctx: Ctx): Promise<void> {
  const decoded = createOrderBodySchema.decode(ctx.body ?? {});
  if (!decoded.ok) throw decoded;
  const identity = adminIdentityOf(ctx);
  const result = await ordersService().createOrder(decoded.value, identity.accountId);
  if (!result.ok) throw shopOrderError(result.error);
  adminOk(ctx.res, shopOrderDetailJson(result.order));
}

/** GET /admin/api/shop/orders/:id: a single order with items + status history. */
async function getHandler(ctx: Ctx): Promise<void> {
  const order = await ordersService().getOrder(adminTargetId(ctx));
  if (!order) throw new HttpError(404, 'shop.not_found');
  adminOk(ctx.res, shopOrderDetailJson(order));
}

/** POST /admin/api/shop/orders/:id/status: move to any allowed next status. */
async function updateStatusHandler(ctx: Ctx): Promise<void> {
  const decoded = updateStatusBodySchema.decode(ctx.body ?? {});
  if (!decoded.ok) throw decoded;
  const identity = adminIdentityOf(ctx);
  const result = await ordersService().updateStatus(
    adminTargetId(ctx),
    decoded.value.status,
    identity.accountId,
    decoded.value.note,
  );
  if (!result.ok) throw shopOrderError(result.error);
  adminOk(ctx.res, shopOrderDetailJson(result.order));
}

/** POST /admin/api/shop/orders/:id/cancel: cancel (releases or restores stock per current status). */
async function cancelHandler(ctx: Ctx): Promise<void> {
  const decoded = noteOnlyBodySchema.decode(ctx.body ?? {});
  if (!decoded.ok) throw decoded;
  const identity = adminIdentityOf(ctx);
  const result = await ordersService().cancelOrder(
    adminTargetId(ctx),
    identity.accountId,
    decoded.value.note,
  );
  if (!result.ok) throw shopOrderError(result.error);
  adminOk(ctx.res, shopOrderDetailJson(result.order));
}

/** POST /admin/api/shop/orders/:id/refund: refund a paid or fulfilled order (restores stock). */
async function refundHandler(ctx: Ctx): Promise<void> {
  const decoded = noteOnlyBodySchema.decode(ctx.body ?? {});
  if (!decoded.ok) throw decoded;
  const identity = adminIdentityOf(ctx);
  const result = await ordersService().refundOrder(
    adminTargetId(ctx),
    identity.accountId,
    decoded.value.note,
  );
  if (!result.ok) throw shopOrderError(result.error);
  adminOk(ctx.res, shopOrderDetailJson(result.order));
}

// ---------------------------------------------------------------------------
// The route table. registry.ts spreads this into apiRoutes.
// ---------------------------------------------------------------------------

export const routes: RouteDef[] = [
  {
    method: 'GET',
    path: '/admin/api/shop/orders',
    surface: 'admin',
    middleware: [requireAdmin],
    meta: ADMIN_META,
    handler: listHandler,
  },
  {
    method: 'POST',
    path: '/admin/api/shop/orders',
    surface: 'admin',
    middleware: [requireAdmin, withBody()],
    meta: ADMIN_META,
    handler: createHandler,
  },
  {
    method: 'GET',
    path: '/admin/api/shop/orders/:id',
    surface: 'admin',
    middleware: [requireAdmin, requireAdminTarget('shop_order')],
    meta: adminTargetMeta('shop_order'),
    handler: getHandler,
  },
  {
    method: 'POST',
    path: '/admin/api/shop/orders/:id/status',
    surface: 'admin',
    middleware: [requireAdmin, withBody(), requireAdminTarget('shop_order')],
    meta: adminTargetMeta('shop_order'),
    handler: updateStatusHandler,
  },
  {
    method: 'POST',
    path: '/admin/api/shop/orders/:id/cancel',
    surface: 'admin',
    middleware: [requireAdmin, withBody(), requireAdminTarget('shop_order')],
    meta: adminTargetMeta('shop_order'),
    handler: cancelHandler,
  },
  {
    method: 'POST',
    path: '/admin/api/shop/orders/:id/refund',
    surface: 'admin',
    middleware: [requireAdmin, withBody(), requireAdminTarget('shop_order')],
    meta: adminTargetMeta('shop_order'),
    handler: refundHandler,
  },
];
