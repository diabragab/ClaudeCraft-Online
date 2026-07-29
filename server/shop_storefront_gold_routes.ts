// In-game Shop Gold checkout (Phase 6): the Gold-priced twin of
// server/shop_storefront_claudium_routes.ts, so the Treasure Chest icon's
// WOC Store can charge the player's own live gold with no external economy
// service in the loop. A thin RouteDef wrapper over ShopGoldCheckoutService
// (server/shop_gold_checkout.ts), which itself is a thin orchestration over
// the EXISTING ShopOrdersService (Phase 3). No pricing, stock, or currency
// logic lives in this file.
//
// characterId travels in the body (not a :id path param, so this route does
// not use the requireOwned middleware factory): the buyer's own account is
// always ctxAccountId(ctx), and characterId ownership is verified inline via
// getCharacter(accountId, characterId) (server/db.ts), mirroring the
// Claudium route exactly.

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
import { type GoldCheckoutErrorCode, ShopGoldCheckoutService } from './shop_gold_checkout';
import { type ShopAccountLookup, ShopOrdersService, shopOrderDetailJson } from './shop_orders';
import { PgShopOrdersDb } from './shop_orders_db';
import { ShopProductsService } from './shop_products';
import { PgShopProductsDb } from './shop_products_db';

// ---------------------------------------------------------------------------
// The service singleton (its own instance over the same real Postgres pool,
// mirroring shop_storefront_claudium_routes.ts). The setter lets a unit test
// drive the route with an in-memory fake.
// ---------------------------------------------------------------------------

const PG_ACCOUNT_LOOKUP: ShopAccountLookup = {
  async accountExists(id: number) {
    const account = await accountById(id);
    return account ? { id: account.id, username: account.username } : null;
  },
};

const REAL_CHECKOUT_SERVICE = new ShopGoldCheckoutService(
  new ShopProductsService(new PgShopProductsDb(pool), new PgShopCategoriesDb(pool)),
  new ShopOrdersService(new PgShopOrdersDb(pool), PG_ACCOUNT_LOOKUP),
);
let checkoutService = REAL_CHECKOUT_SERVICE;

export function setShopGoldCheckoutServiceForTests(service: ShopGoldCheckoutService): void {
  checkoutService = service;
}

export function resetShopGoldCheckoutServiceForTests(): void {
  checkoutService = REAL_CHECKOUT_SERVICE;
}

/** The narrow character-ownership read this route needs; swappable for tests. */
export interface ShopGoldCharacterLookup {
  getCharacter(accountId: number, characterId: number): Promise<{ id: number } | null>;
}
const REAL_CHARACTER_LOOKUP: ShopGoldCharacterLookup = { getCharacter };
let characterLookup = REAL_CHARACTER_LOOKUP;

export function setShopGoldCharacterLookupForTests(lookup: ShopGoldCharacterLookup): void {
  characterLookup = lookup;
}

export function resetShopGoldCharacterLookupForTests(): void {
  characterLookup = REAL_CHARACTER_LOOKUP;
}

// ---------------------------------------------------------------------------
// Auth (mirrors shop_storefront_claudium_routes.ts's own swappable authDb bundle).
// ---------------------------------------------------------------------------

export interface ShopGoldAuthDb {
  accountAndScopeForToken(token: string): Promise<{ accountId: number; scope: TokenScope } | null>;
  moderationStatusForAccount(accountId: number): Promise<AccountModerationStatus>;
}
const REAL_AUTH_DB: ShopGoldAuthDb = { accountAndScopeForToken, moderationStatusForAccount };
let authDb = REAL_AUTH_DB;

export function setShopGoldAuthDbForTests(db: ShopGoldAuthDb): void {
  authDb = db;
}

export function resetShopGoldAuthDbForTests(): void {
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

function checkoutError(error: GoldCheckoutErrorCode): HttpError {
  switch (error) {
    case 'not_found':
    case 'product_not_found':
      return new HttpError(404, 'shop.not_found');
    case 'not_deliverable':
      return new HttpError(400, 'shop.not_deliverable');
    case 'insufficient_gold':
      return new HttpError(402, 'shop.insufficient_gold');
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

/** POST /api/shop/gold/purchase: buy one product with gold, delivered immediately. */
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
    path: '/api/shop/gold/purchase',
    surface: 'api',
    middleware: [activeAccount, withBody()],
    handler: purchaseHandler,
  },
];
