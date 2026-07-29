// Claudium Package purchase checkout (Phase 8): the player-facing route that
// starts a real-money Stripe Checkout Session for a Claudium Package. Lives
// under /api/shop/packages/*, alongside the existing public catalog read
// (server/shop_storefront_packages_routes.ts) and separate from the legacy
// /api/claudium/* external-service prefix (server/claudium.ts).
//
// success_url/cancel_url are built SERVER-SIDE from the request's own origin
// (server/realm.ts publicOriginFromRequest), never accepted from the client:
// an attacker-supplied redirect target would be an open-redirect vector on a
// real-money checkout flow. The web storefront's Packages page
// (src/store/pages/packages.ts, Phase 8 task #80) is what redirects the
// player here in a new tab; Stripe redirects back to that same storefront's
// confirmation page on success.

import { requireAdmin } from './admin';
import { ClaudiumLedgerService } from './claudium_ledger';
import { PgClaudiumLedgerDb } from './claudium_ledger_db';
import { ClaudiumPackagesService } from './claudium_packages';
import { PgClaudiumPackagesDb } from './claudium_packages_db';
import {
  type ClaudiumPurchaseErrorCode,
  ClaudiumPurchasesService,
  claudiumPurchaseJson,
} from './claudium_purchases';
import type { ClaudiumPurchaseRecord } from './claudium_purchases_db';
import { PgClaudiumPurchasesDb } from './claudium_purchases_db';
import {
  type AccountModerationStatus,
  accountAndScopeForToken,
  moderationStatusForAccount,
  pool,
  type TokenScope,
} from './db';
import { adminOk } from './http/admin_envelope';
import { ctxAccountId } from './http/context';
import { HttpError } from './http/errors';
import { requireAccount } from './http/middleware/require_account';
import { ADMIN_META } from './http/middleware/require_admin';
import { enum_, num, object, optional, str } from './http/schema';
import type { Ctx, Middleware, RouteDef } from './http/types';
import { json } from './http_util';
import { publicOriginFromRequest } from './realm';
import { RealStripeCheckoutCreator } from './stripe_checkout_creator';

// ---------------------------------------------------------------------------
// The service singleton. The setter lets a unit test drive the routes with
// an in-memory fake (mirrors shop_buy_routes.ts's own pattern).
// ---------------------------------------------------------------------------

const REAL_PURCHASES_SERVICE = new ClaudiumPurchasesService(
  new PgClaudiumPackagesDb(pool),
  new ClaudiumLedgerService(new PgClaudiumLedgerDb(pool)),
  new PgClaudiumPurchasesDb(pool),
  new RealStripeCheckoutCreator(),
);
let purchasesService = REAL_PURCHASES_SERVICE;

export function setClaudiumPurchasesServiceForTests(service: ClaudiumPurchasesService): void {
  purchasesService = service;
}

export function resetClaudiumPurchasesServiceForTests(): void {
  purchasesService = REAL_PURCHASES_SERVICE;
}

/** Exposed so server/stripe_webhook_routes.ts (Phase 8 task #77) shares the
 *  exact same service instance rather than standing up a second one. */
export function claudiumPurchasesServiceInstance(): ClaudiumPurchasesService {
  return purchasesService;
}

// ---------------------------------------------------------------------------
// Auth (mirrors shop_buy_routes.ts's own swappable authDb bundle).
// ---------------------------------------------------------------------------

export interface ClaudiumPurchasesAuthDb {
  accountAndScopeForToken(token: string): Promise<{ accountId: number; scope: TokenScope } | null>;
  moderationStatusForAccount(accountId: number): Promise<AccountModerationStatus>;
}
const REAL_AUTH_DB: ClaudiumPurchasesAuthDb = {
  accountAndScopeForToken,
  moderationStatusForAccount,
};
let authDb = REAL_AUTH_DB;

export function setClaudiumPurchasesAuthDbForTests(db: ClaudiumPurchasesAuthDb): void {
  authDb = db;
}

export function resetClaudiumPurchasesAuthDbForTests(): void {
  authDb = REAL_AUTH_DB;
}

const activeAccount = requireAccount({
  scope: 'active',
  lookupToken: (token) => authDb.accountAndScopeForToken(token),
  moderationStatus: (accountId) => authDb.moderationStatusForAccount(accountId),
});

// ---------------------------------------------------------------------------
// Request shape.
// ---------------------------------------------------------------------------

const checkoutParamsSchema = object({
  id: num({ int: true, min: 1 }),
});

const statusParamsSchema = object({
  sessionId: str({ minLength: 1, maxLength: 255 }),
});

const purchaseStatusEnum = enum_(['pending', 'paid', 'failed', 'expired', 'refunded']);
const purchaseSortEnum = enum_(['createdAt', 'updatedAt']);
const sortDirEnum = enum_(['asc', 'desc']);

const listPurchasesQuerySchema = object({
  page: optional(num({ int: true, min: 1 }), 1),
  limit: optional(num({ int: true, min: 1, max: 100 }), 20),
  accountId: optional(num({ int: true, min: 1 })),
  status: optional(purchaseStatusEnum),
  sort: optional(purchaseSortEnum, 'createdAt'),
  dir: optional(sortDirEnum, 'desc'),
});

function purchaseError(error: ClaudiumPurchaseErrorCode): HttpError {
  switch (error) {
    case 'package_not_found':
      return new HttpError(404, 'shop.package_not_found');
    case 'package_disabled':
      return new HttpError(400, 'shop.package_disabled');
    case 'stripe_unavailable':
      return new HttpError(503, 'shop.stripe_unavailable');
    case 'purchase_not_found':
      return new HttpError(404, 'shop.purchase_not_found');
    default:
      return new HttpError(400, 'shop.invalid_input');
  }
}

// ---------------------------------------------------------------------------
// Handler.
// ---------------------------------------------------------------------------

/** POST /api/shop/packages/:id/checkout: start a Stripe Checkout Session for
 *  one Claudium Package; returns the hosted checkout URL to redirect to. */
async function checkoutHandler(ctx: Ctx): Promise<void> {
  const decoded = checkoutParamsSchema.decode(ctx.params);
  if (!decoded.ok) throw decoded;
  const origin = publicOriginFromRequest(ctx.req);
  const result = await purchasesService.createCheckout({
    accountId: ctxAccountId(ctx),
    packageId: decoded.value.id,
    successUrl: `${origin}/store/packages/confirmation?session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${origin}/store/packages`,
  });
  if (!result.ok) throw purchaseError(result.error);
  json(ctx.res, 200, { url: result.url, sessionId: result.sessionId });
}

// The legacy-shaped denial body, byte-compatible with require_owned.ts's own
// notFoundBody convention (an { error, code } object written directly, never
// thrown as an HttpError/problem+json envelope).
const PURCHASE_NOT_FOUND_BODY = { error: 'not found', code: 'shop.purchase_not_found' };
const PURCHASE_STATE_KEY = 'claudium_purchase';

/** Load-then-authorize middleware for GET /api/shop/packages/purchases/:sessionId,
 *  mirroring server/http/middleware/require_owned.ts's contract (decode the
 *  param, load account-scoped, deny-by-default on a miss by writing the 404
 *  directly and never calling next(), stash the loaded row on ctx.state on a
 *  hit) but for a STRING param: sessionId is a Stripe opaque token, not a
 *  bigserial, so requireOwned's numeric-only id decoder does not apply and
 *  this is a sibling implementation rather than a reuse of that factory. */
const requireOwnedPurchase: Middleware = async (ctx, next) => {
  const decoded = statusParamsSchema.decode(ctx.params);
  if (!decoded.ok) throw decoded;
  const accountId = ctxAccountId(ctx);
  const purchase = await purchasesService.getPurchaseBySessionId(decoded.value.sessionId);
  if (!purchase || purchase.accountId !== accountId) {
    json(ctx.res, 404, PURCHASE_NOT_FOUND_BODY);
    return;
  }
  ctx.state.set(PURCHASE_STATE_KEY, purchase);
  await next();
};

/** GET /api/shop/packages/purchases/:sessionId: the caller's own purchase
 *  status, for the storefront confirmation page to poll while the webhook
 *  catches up. Ownership already authorized by requireOwnedPurchase above. */
async function purchaseStatusHandler(ctx: Ctx): Promise<void> {
  const purchase = ctx.state.get(PURCHASE_STATE_KEY) as ClaudiumPurchaseRecord;
  json(ctx.res, 200, claudiumPurchaseJson(purchase));
}

/** GET /admin/api/shop/claudium/purchases: the payment history / audit log
 *  the Admin Panel lists, paginated and optionally filtered by account or
 *  status. */
async function listPurchasesHandler(ctx: Ctx): Promise<void> {
  const decoded = listPurchasesQuerySchema.decode(ctx.query);
  if (!decoded.ok) throw decoded;
  const { rows, total } = await purchasesService.listPurchases(decoded.value);
  adminOk(ctx.res, {
    rows: rows.map(claudiumPurchaseJson),
    total,
    page: decoded.value.page,
    limit: decoded.value.limit,
  });
}

// ---------------------------------------------------------------------------
// The route table. registry.ts spreads this into apiRoutes. Registry-only:
// no legacy ladder twin (a brand-new surface).
// ---------------------------------------------------------------------------

export const routes: RouteDef[] = [
  {
    method: 'POST',
    path: '/api/shop/packages/:id/checkout',
    surface: 'api',
    middleware: [activeAccount],
    // :id is the PACKAGE id (a catalog item, not an account-owned resource):
    // publicRead marks the intentional no-ownership-check :id route (see
    // tests/server/helpers/registry_introspect.ts), not literal anonymous
    // access (activeAccount above still requires a full-scope bearer token).
    meta: { publicRead: true },
    handler: checkoutHandler,
  },
  {
    method: 'GET',
    path: '/api/shop/packages/purchases/:sessionId',
    surface: 'api',
    middleware: [activeAccount, requireOwnedPurchase],
    meta: { requireOwned: { kind: 'claudium_purchase', ownerScope: 'account' } },
    handler: purchaseStatusHandler,
  },
  {
    method: 'GET',
    path: '/admin/api/shop/claudium/purchases',
    surface: 'admin',
    middleware: [requireAdmin],
    meta: ADMIN_META,
    handler: listPurchasesHandler,
  },
];
