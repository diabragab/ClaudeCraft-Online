// In-game Shop checkout (Phase 7): the internal-Claudium-ledger twin of the
// retired ShopGoldCheckoutService/ShopClaudiumCheckoutService (both removed
// in the same change this module was added: see server/CLAUDE.md's history
// for why the old Gold purse and the old external-service Claudium checkout
// no longer exist). ShopOrdersService (Phase 3, unchanged) still reserves
// stock and owns the order record; the currency call is ClaudiumLedgerService
// (server/claudium_ledger.ts, the one seam every Claudium-moving caller goes
// through), and delivery goes through the same shared deliverShopProduct
// (server/shop_delivery.ts) every prior checkout used. No new pricing, stock,
// or currency logic lives here; this module only sequences existing calls in
// a safe order.
//
// Ordering: RESERVE stock first (an ordinary pending order), THEN debit
// Claudium, THEN mark paid + deliver. If the debit fails (insufficient
// balance), the pending order is simply cancelled (its reservation released)
// and no Claudium ever moves.

import type { ClaudiumLedgerService } from './claudium_ledger';
import type { ShopAnnouncementService } from './shop_announcement';
import { deliverShopProduct } from './shop_delivery';
import type { ShopOrderDetail, ShopOrderErrorCode, ShopOrdersService } from './shop_orders';
import type { ShopProductsService } from './shop_products';

export type LedgerCheckoutErrorCode =
  | 'not_found'
  | 'not_deliverable'
  | 'insufficient_claudium'
  | ShopOrderErrorCode;

export type LedgerCheckoutResult =
  | { ok: true; order: ShopOrderDetail; balance: number }
  | { ok: false; error: LedgerCheckoutErrorCode; balance?: number | null };

export interface LedgerCheckoutRequest {
  accountId: number;
  /** The buyer's own live character; ownership is verified by the caller (the route). */
  characterId: number;
  productId: number;
  quantity: number;
  /** The buyer's display name, for the Phase 2D purchase announcement's
   *  {player} placeholder; omitted (or the announcer arg below being null)
   *  simply skips the announcement, never the checkout itself. */
  characterName?: string;
}

export class ShopLedgerCheckoutService {
  constructor(
    private readonly products: ShopProductsService,
    private readonly orders: ShopOrdersService,
    private readonly ledger: ClaudiumLedgerService,
    private readonly announcer: ShopAnnouncementService | null = null,
  ) {}

  async purchase(req: LedgerCheckoutRequest): Promise<LedgerCheckoutResult> {
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

    const debit = await this.ledger.removeBalance(
      req.accountId,
      order.totalAmount,
      'PURCHASE',
      `shop-order-${order.id}`,
    );
    if (!debit.ok || debit.balance === null) {
      await this.orders.cancelOrder(order.id, null, 'claudium spend failed: insufficient balance');
      return { ok: false, error: 'insufficient_claudium', balance: null };
    }

    const paidResult = await this.orders.updateStatus(
      order.id,
      'paid',
      null,
      'claudium payment settled',
    );
    const paidOrder = paidResult.ok ? paidResult.order : order;
    deliverShopProduct(product, req.characterId, req.accountId, req.quantity);
    if (req.characterName) {
      void this.announcer?.announcePurchase({
        playerName: req.characterName,
        productName: product.name,
        rarity: product.rarity,
        templateOverride: product.announcementTemplate,
      });
    }
    return { ok: true, order: paidOrder, balance: debit.balance };
  }
}
