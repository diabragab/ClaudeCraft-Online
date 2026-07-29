// In-game Shop Claudium checkout (Phase 5): the one route the HUD's Store tab
// calls to buy something. A thin RouteDef wrapper over
// ShopClaudiumCheckoutService (server/shop_claudium_checkout.ts), which itself
// is a thin orchestration over the EXISTING ShopOrdersService (Phase 3) and
// claudiumSpend (server/claudium_proxy.ts, unchanged). No pricing, stock, or
// currency logic lives in this file.
//
// characterId travels in the body (not a :id path param, so this route does
// not use the requireOwned middleware factory): the buyer's own account is
// always ctxAccountId(ctx), and characterId ownership is verified inline via
// getCharacter(accountId, characterId) (server/db.ts, the same ownership read
// server/characters.ts's own owner-gated routes use) before any Claudium
// moves. A caller passing a characterId that is not theirs gets the same
// shop.character_not_found the route would give for a nonexistent id
// (anti-enumeration, same posture as the requireOwned 404 convention).

import type { AccountModerationStatus, TokenScope } from './db';
import {
  accountAndScopeForToken,
  accountById,
  getCharacter,
  moderationStatusForAccount,
  pool,
} from './db';
import { ctxAccountId } from './http/context';
import { HttpError } from './http/errors';
import { withBody } from './http/middleware/body';
import { requireAccount } from './http/middleware/require_account';
import { num, object, optional } from './http/schema';
import type { Ctx, RouteDef } from './http/types';
import { json } from './http_util';
import { PgShopCategoriesDb } from './shop_categories_db';
import {
  type ClaudiumCheckoutErrorCode,
  ShopClaudiumCheckoutService,
} from './shop_claudium_checkout';
import { type ShopAccountLookup, ShopOrdersService, shopOrderDetailJson } from './shop_orders';
import { PgShopOrdersDb } from './shop_orders_db';
import { ShopProductsService } from './shop_products';
import { PgShopProductsDb } from './shop_products_db';

// ---------------------------------------------------------------------------
// The service singleton (its own instances over the same real Postgres pool,
// mirroring shop_storefront_orders_routes.ts). The setter lets a unit test
// drive the route with an in-memory fake.
// ---------------------------------------------------------------------------

const PG_ACCOUNT_LOOKUP: ShopAccountLookup = {
  async accountExists(id: number) {
    const account = await accountById(id);
    return account ? { id: account.id, username: account.username } : null;
  },
};

const REAL_CHECKOUT_SERVICE = new ShopClaudiumCheckoutService(
  new ShopProductsService(new PgShopProductsDb(pool), new PgShopCategoriesDb(pool)),
  new ShopOrdersService(new PgShopOrdersDb(pool), PG_ACCOUNT_LOOKUP),
);
let checkoutService = REAL_CHECKOUT_SERVICE;

export function setShopClaudiumCheckoutServiceForTests(service: ShopClaudiumCheckoutService): void {
  checkoutService = service;
}

export function resetShopClaudiumCheckoutServiceForTests(): void {
  checkoutService = REAL_CHECKOUT_SERVICE;
}

/** The narrow character-ownership read this route needs; swappable for tests. */
export interface ShopClaudiumCharacterLookup {
  getCharacter(accountId: number, characterId: number): Promise<{ id: number } | null>;
}
const REAL_CHARACTER_LOOKUP: ShopClaudiumCharacterLookup = { getCharacter };
let characterLookup = REAL_CHARACTER_LOOKUP;

export function setShopClaudiumCharacterLookupForTests(lookup: ShopClaudiumCharacterLookup): void {
  characterLookup = lookup;
}

export function resetShopClaudiumCharacterLookupForTests(): void {
  characterLookup = REAL_CHARACTER_LOOKUP;
}

// ---------------------------------------------------------------------------
// Auth (mirrors shop_storefront_orders_routes.ts's own swappable authDb bundle).
// ---------------------------------------------------------------------------

export interface ShopClaudiumAuthDb {
  accountAndScopeForToken(token: string): Promise<{ accountId: number; scope: TokenScope } | null>;
  moderationStatusForAccount(accountId: number): Promise<AccountModerationStatus>;
}
const REAL_AUTH_DB: ShopClaudiumAuthDb = { accountAndScopeForToken, moderationStatusForAccount };
let authDb = REAL_AUTH_DB;

export function setShopClaudiumAuthDbForTests(db: ShopClaudiumAuthDb): void {
  authDb = db;
}

export function resetShopClaudiumAuthDbForTests(): void {
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

const purchaseBodySchema = object({
  productId: num({ int: true, min: 1 }),
  characterId: num({ int: true, min: 1 }),
  quantity: optional(num({ int: true, min: 1, max: 999 }), 1),
});

function checkoutError(error: ClaudiumCheckoutErrorCode): HttpError {
  switch (error) {
    case 'not_found':
    case 'product_not_found':
      return new HttpError(404, 'shop.not_found');
    case 'not_deliverable':
      return new HttpError(400, 'shop.not_deliverable');
    case 'insufficient_balance':
      return new HttpError(402, 'shop.insufficient_claudium');
    case 'price_changed':
      return new HttpError(409, 'shop.price_changed');
    case 'spend_unavailable':
      return new HttpError(503, 'shop.claudium_unavailable');
    case 'not_tracked':
    case 'insufficient_stock':
      return new HttpError(400, 'shop.out_of_stock');
    case 'empty_items':
    case 'product_not_active':
    case 'price_not_set':
      return new HttpError(400, 'shop.invalid_input');
    default:
      return new HttpError(400, 'shop.invalid_input');
  }
}

// ---------------------------------------------------------------------------
// Handler.
// ---------------------------------------------------------------------------

/** POST /api/shop/claudium/purchase: buy one product with Claudium, delivered immediately. */
async function purchaseHandler(ctx: Ctx): Promise<void> {
  const decoded = purchaseBodySchema.decode(ctx.body ?? {});
  if (!decoded.ok) throw decoded;
  const accountId = ctxAccountId(ctx);
  const character = await characterLookup.getCharacter(accountId, decoded.value.characterId);
  if (!character) throw new HttpError(404, 'shop.character_not_found');

  const result = await checkoutService.purchase({
    accountId,
    characterId: decoded.value.characterId,
    productId: decoded.value.productId,
    quantity: decoded.value.quantity,
  });
  if (!result.ok) throw checkoutError(result.error);
  json(ctx.res, 200, { order: shopOrderDetailJson(result.order), balance: result.balance });
}

// ---------------------------------------------------------------------------
// The route table. registry.ts spreads this into apiRoutes. Registry-only:
// no legacy ladder twin (a brand-new player-facing surface).
// ---------------------------------------------------------------------------

export const routes: RouteDef[] = [
  {
    method: 'POST',
    path: '/api/shop/claudium/purchase',
    surface: 'api',
    middleware: [activeAccount, withBody()],
    handler: purchaseHandler,
  },
];
