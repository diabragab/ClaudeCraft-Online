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

import { ClaudiumLedgerService } from './claudium_ledger';
import { PgClaudiumLedgerDb } from './claudium_ledger_db';
import { ClaudiumPackagesService } from './claudium_packages';
import { PgClaudiumPackagesDb } from './claudium_packages_db';
import { type ClaudiumPurchaseErrorCode, ClaudiumPurchasesService } from './claudium_purchases';
import { PgClaudiumPurchasesDb } from './claudium_purchases_db';
import {
  type AccountModerationStatus,
  accountAndScopeForToken,
  moderationStatusForAccount,
  pool,
  type TokenScope,
} from './db';
import { ctxAccountId } from './http/context';
import { HttpError } from './http/errors';
import { requireAccount } from './http/middleware/require_account';
import { num, object } from './http/schema';
import type { Ctx, RouteDef } from './http/types';
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

// ---------------------------------------------------------------------------
// The route table. registry.ts spreads this into apiRoutes. Registry-only:
// no legacy ladder twin (a brand-new player-facing surface).
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
];
