// In-game Shop checkout (Phase 6): the Gold-priced twin of
// ShopClaudiumCheckoutService (server/shop_claudium_checkout.ts), so the
// Treasure Chest icon's WOC Store can sell shop_products with no external
// economy service in the loop. ShopOrdersService (Phase 3, unchanged) still
// reserves stock and owns the order record; the currency call is the
// player's own live copper purse (Sim.spendShopGold, reached through
// GameServer.spendShopGoldFromCharacter via the injected runtime hook below)
// instead of claudiumSpend, and delivery goes through the exact same shared
// deliverShopProduct (server/shop_delivery.ts) the Claudium checkout uses.
// No new pricing, stock, or currency logic lives here; this module only
// sequences existing calls in a safe order.
//
// Ordering mirrors the Claudium checkout deliberately: RESERVE stock first
// (an ordinary pending order), THEN deduct gold, THEN mark paid + deliver.
// If the deduction fails, the pending order is simply cancelled (its
// reservation released) and no gold ever moved.

import { deliverShopProduct } from './shop_delivery';
import type { ShopOrderDetail, ShopOrderErrorCode, ShopOrdersService } from './shop_orders';
import type { ShopProductsService } from './shop_products';

// spendGoldFromCharacter returns null for both "insufficient gold" and "no
// live session" (the latter should never happen: a gold purchase always
// originates from that character's own active session, same rationale as
// the Claudium checkout), so both collapse to the one player-facing reason.
export type GoldCheckoutErrorCode =
  | 'not_found'
  | 'not_deliverable'
  | 'insufficient_gold'
  | ShopOrderErrorCode;

export type GoldCheckoutResult =
  | { ok: true; order: ShopOrderDetail; balance: number | null }
  | { ok: false; error: GoldCheckoutErrorCode; balance?: number | null };

export interface GoldCheckoutRequest {
  accountId: number;
  /** The buyer's own live character; ownership is verified by the caller (the route). */
  characterId: number;
  productId: number;
  quantity: number;
}

/**
 * Live-game hook, injected from server/main.ts exactly like
 * configureShopDeliveryRuntime so `ShopGoldCheckoutService` stays
 * constructible without an import cycle into server/game.ts.
 */
export interface ShopGoldSpendRuntimeHooks {
  /** Deducts amountCopper from the character's live gold and returns the
   *  resulting balance, or null when the character has no live session on
   *  this realm or does not have enough gold (no partial deduction). */
  spendGoldFromCharacter(characterId: number, amountCopper: number): number | null;
}
let goldRuntime: ShopGoldSpendRuntimeHooks | null = null;

export function configureShopGoldCheckoutRuntime(rt: ShopGoldSpendRuntimeHooks): void {
  goldRuntime = rt;
}

export class ShopGoldCheckoutService {
  constructor(
    private readonly products: ShopProductsService,
    private readonly orders: ShopOrdersService,
  ) {}

  async purchase(req: GoldCheckoutRequest): Promise<GoldCheckoutResult> {
    const product = await this.products.getProduct(req.productId);
    if (!product) return { ok: false, error: 'not_found' };
    if (product.grantKind === 'none') return { ok: false, error: 'not_deliverable' };

    const orderResult = await this.orders.createOrder(
      {
        accountId: req.accountId,
        currency: 'gold',
        items: [{ productId: req.productId, quantity: req.quantity }],
        note: 'In-game Shop purchase',
      },
      null,
    );
    if (!orderResult.ok) {
      // account_not_found cannot happen here (the caller's own account made
      // the request); every other ShopOrderErrorCode passes through as-is.
      return { ok: false, error: orderResult.error };
    }
    const order = orderResult.order;

    const balance = goldRuntime?.spendGoldFromCharacter(req.characterId, order.totalAmount) ?? null;
    if (balance === null) {
      await this.orders.cancelOrder(
        order.id,
        null,
        'gold spend failed: insufficient funds or no session',
      );
      return { ok: false, error: 'insufficient_gold', balance: null };
    }

    const paidResult = await this.orders.updateStatus(
      order.id,
      'paid',
      null,
      'gold payment settled',
    );
    const paidOrder = paidResult.ok ? paidResult.order : order;
    deliverShopProduct(product, req.characterId, req.accountId, req.quantity);
    return { ok: true, order: paidOrder, balance };
  }
}
