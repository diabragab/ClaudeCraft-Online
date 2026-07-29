// In-game Shop checkout (Phase 5): the one player-facing path that pays with
// Claudium and delivers immediately, replacing the old WOC Store Armory's
// bespoke spend-then-grant flow with a thin orchestration over the EXISTING
// pieces: ShopOrdersService (Phase 3, unchanged) reserves stock and owns the
// order record, claudiumSpend (server/claudium_proxy.ts, unchanged) is the
// same account-authoritative currency call the Armory always used, and
// delivery goes through the shared deliverShopProduct (server/shop_delivery.ts,
// Phase 6), the same function the Gold checkout (server/shop_gold_checkout.ts)
// uses. No new pricing, stock, or currency logic lives here; this module only
// sequences existing calls in a safe order.
//
// Ordering is deliberate: RESERVE stock first (an ordinary pending order),
// THEN charge Claudium, THEN mark paid + deliver. If the charge fails, the
// pending order is simply cancelled (its reservation released) and no money
// ever moved. This keeps the one failure mode that actually matters (a
// player is charged Claudium and receives nothing) to the smallest possible
// surface: the in-process, no-network delivery step after a successful,
// already-recorded payment, rather than any external call.

import { claudiumSpend } from './claudium_proxy';
import { deliverShopProduct } from './shop_delivery';
import type { ShopOrderDetail, ShopOrderErrorCode, ShopOrdersService } from './shop_orders';
import type { ShopProductsService } from './shop_products';

export type ClaudiumCheckoutErrorCode =
  | 'not_found'
  | 'not_deliverable'
  | 'insufficient_balance'
  | 'price_changed'
  | 'spend_unavailable'
  | ShopOrderErrorCode;

export type ClaudiumCheckoutResult =
  | { ok: true; order: ShopOrderDetail; balance: number | null }
  | {
      ok: false;
      error: ClaudiumCheckoutErrorCode;
      balance?: number | null;
      costClaudium?: number | null;
    };

export interface ClaudiumCheckoutRequest {
  accountId: number;
  /** The buyer's own live character; ownership is verified by the caller (the route). */
  characterId: number;
  productId: number;
  quantity: number;
}

export class ShopClaudiumCheckoutService {
  constructor(
    private readonly products: ShopProductsService,
    private readonly orders: ShopOrdersService,
  ) {}

  async purchase(req: ClaudiumCheckoutRequest): Promise<ClaudiumCheckoutResult> {
    const product = await this.products.getProduct(req.productId);
    if (!product) return { ok: false, error: 'not_found' };
    if (product.grantKind === 'none') return { ok: false, error: 'not_deliverable' };

    const orderResult = await this.orders.createOrder(
      {
        accountId: req.accountId,
        currency: 'claudium',
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

    const spend = await claudiumSpend({
      accountId: req.accountId,
      itemId: product.grantItemId ?? product.sku,
      kind: product.grantKind === 'weapon_skin' ? 'skin' : 'item',
      expectedCostClaudium: order.totalAmount,
      // Deterministic per order: a retried request for the SAME pending
      // order (a dropped response, a client re-submit) replays the same
      // idempotency key instead of spending twice.
      idempotencyKey: `shop-order-${order.id}`,
    });
    if (!spend.granted) {
      await this.orders.cancelOrder(
        order.id,
        null,
        `claudium spend failed: ${spend.reason ?? 'unknown'}`,
      );
      return {
        ok: false,
        error: mapSpendReason(spend.reason),
        balance: spend.balance,
        costClaudium: spend.costClaudium,
      };
    }

    const paidResult = await this.orders.updateStatus(
      order.id,
      'paid',
      null,
      'claudium payment settled',
    );
    const paidOrder = paidResult.ok ? paidResult.order : order;
    deliverShopProduct(product, req.characterId, req.accountId, req.quantity);
    return { ok: true, order: paidOrder, balance: spend.balance };
  }
}

function mapSpendReason(reason: string | null): ClaudiumCheckoutErrorCode {
  if (reason === 'insufficient_balance') return 'insufficient_balance';
  if (reason === 'price_changed') return 'price_changed';
  return 'spend_unavailable';
}
