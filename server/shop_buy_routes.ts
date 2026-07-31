// In-game Shop checkout (Phase 7): POST /api/shop/buy, the one route the
// HUD's Store tab calls to buy something, now priced and paid entirely in
// the internal Claudium ledger (server/claudium_ledger.ts). A thin RouteDef
// wrapper over ShopLedgerCheckoutService (server/shop_ledger_checkout.ts),
// itself a thin orchestration over the EXISTING ShopOrdersService (Phase 3).
// No pricing, stock, or currency logic lives in this file.
//
// characterId travels in the body (not a :id path param, so this route does
// not use the requireOwned middleware factory): the buyer's own account is
// always ctxAccountId(ctx), and characterId ownership is verified inline via
// getCharacter(accountId, characterId) (server/db.ts), the same pattern the
// retired Gold/external-Claudium checkout routes used.

import { ClaudiumLedgerService } from './claudium_ledger';
import type { ClaudiumLedgerDb } from './claudium_ledger_db';
import { PgClaudiumLedgerDb } from './claudium_ledger_db';
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
import { ShopAnnouncementService } from './shop_announcement';
import { PgShopAnnouncementConfigDb } from './shop_announcement_config_db';
import { PgShopCategoriesDb } from './shop_categories_db';
import { type LedgerCheckoutErrorCode, ShopLedgerCheckoutService } from './shop_ledger_checkout';
import { type ShopAccountLookup, ShopOrdersService, shopOrderDetailJson } from './shop_orders';
import { PgShopOrdersDb } from './shop_orders_db';
import { ShopProductsService } from './shop_products';
import { PgShopProductsDb } from './shop_products_db';

// ---------------------------------------------------------------------------
// The service singleton (its own instance over the same real Postgres pool).
// The setter lets a unit test drive the route with an in-memory fake.
// ---------------------------------------------------------------------------

const PG_ACCOUNT_LOOKUP: ShopAccountLookup = {
  async accountExists(id: number) {
    const account = await accountById(id);
    return account ? { id: account.id, username: account.username } : null;
  },
};

const REAL_LEDGER_DB: ClaudiumLedgerDb = new PgClaudiumLedgerDb(pool);
const REAL_CHECKOUT_SERVICE = new ShopLedgerCheckoutService(
  new ShopProductsService(new PgShopProductsDb(pool), new PgShopCategoriesDb(pool)),
  new ShopOrdersService(new PgShopOrdersDb(pool), PG_ACCOUNT_LOOKUP),
  new ClaudiumLedgerService(REAL_LEDGER_DB),
  new ShopAnnouncementService(new PgShopAnnouncementConfigDb()),
);
let checkoutService = REAL_CHECKOUT_SERVICE;

export function setShopBuyCheckoutServiceForTests(service: ShopLedgerCheckoutService): void {
  checkoutService = service;
}

export function resetShopBuyCheckoutServiceForTests(): void {
  checkoutService = REAL_CHECKOUT_SERVICE;
}

/** The narrow character-ownership read this route needs; swappable for tests.
 *  name feeds the Phase 2D purchase announcement's {player} placeholder. */
export interface ShopBuyCharacterLookup {
  getCharacter(
    accountId: number,
    characterId: number,
  ): Promise<{ id: number; name: string } | null>;
}
const REAL_CHARACTER_LOOKUP: ShopBuyCharacterLookup = { getCharacter };
let characterLookup = REAL_CHARACTER_LOOKUP;

export function setShopBuyCharacterLookupForTests(lookup: ShopBuyCharacterLookup): void {
  characterLookup = lookup;
}

export function resetShopBuyCharacterLookupForTests(): void {
  characterLookup = REAL_CHARACTER_LOOKUP;
}

// ---------------------------------------------------------------------------
// Auth (mirrors the retired shop_storefront_gold_routes.ts's own swappable authDb bundle).
// ---------------------------------------------------------------------------

export interface ShopBuyAuthDb {
  accountAndScopeForToken(token: string): Promise<{ accountId: number; scope: TokenScope } | null>;
  moderationStatusForAccount(accountId: number): Promise<AccountModerationStatus>;
}
const REAL_AUTH_DB: ShopBuyAuthDb = { accountAndScopeForToken, moderationStatusForAccount };
let authDb = REAL_AUTH_DB;

export function setShopBuyAuthDbForTests(db: ShopBuyAuthDb): void {
  authDb = db;
}

export function resetShopBuyAuthDbForTests(): void {
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

const buyBodySchema = object({
  productId: num({ int: true, min: 1 }),
  characterId: num({ int: true, min: 1 }),
  quantity: optional(num({ int: true, min: 1, max: 999 }), 1),
});

function checkoutError(error: LedgerCheckoutErrorCode): HttpError {
  switch (error) {
    case 'not_found':
    case 'product_not_found':
      return new HttpError(404, 'shop.not_found');
    case 'not_deliverable':
      return new HttpError(400, 'shop.not_deliverable');
    case 'insufficient_claudium':
      return new HttpError(402, 'shop.insufficient_claudium');
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

/** POST /api/shop/buy: buy one product with Claudium, delivered immediately. */
async function buyHandler(ctx: Ctx): Promise<void> {
  const decoded = buyBodySchema.decode(ctx.body ?? {});
  if (!decoded.ok) throw decoded;
  const accountId = ctxAccountId(ctx);
  const character = await characterLookup.getCharacter(accountId, decoded.value.characterId);
  if (!character) throw new HttpError(404, 'shop.character_not_found');

  const result = await checkoutService.purchase({
    accountId,
    characterId: decoded.value.characterId,
    productId: decoded.value.productId,
    quantity: decoded.value.quantity,
    characterName: character.name,
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
    path: '/api/shop/buy',
    surface: 'api',
    middleware: [activeAccount, withBody()],
    handler: buyHandler,
  },
];
