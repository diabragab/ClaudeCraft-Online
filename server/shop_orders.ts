// Shop catalog: order business rules (Phase 3, admin-managed orders over the
// Phase 1/2 catalog). Mirrors the ShopCategoriesService / ShopProductsService /
// ShopInventoryService split: validation and the order state machine against a
// narrow ShopOrdersDb interface, zero SQL, zero HTTP.
//
// Scope (per the Phase 3 brief): no payment gateway and no customer
// storefront yet, so every order in this phase is created and managed by an
// operator (gated by shop.manage/shop.read, the same permissions Categories/
// Products/Inventory already use) - a back-office order-entry and fulfillment
// tool, not a live player checkout. A later phase can add a player-facing
// create-order surface without changing this state machine.
//
// The order lifecycle:
//   pending -> paid       (stock RESERVED at pending becomes a real DEDUCTION)
//   pending -> cancelled  (the reservation is released, on-hand never moved)
//   paid    -> fulfilled  (no stock effect; marks the sale complete)
//   paid    -> cancelled  (on-hand is RESTORED: the sale is undone post-payment)
//   paid    -> refunded   (on-hand is RESTORED)
//   fulfilled -> refunded (on-hand is RESTORED)
// Every other (from, to) pair is rejected. "Inventory decreases only after a
// successful purchase" (the Phase 3 business rule) is why on-hand only moves
// at the pending->paid transition, never at order creation: creation only
// reserves against shop_inventory.quantity_reserved (the column Phase 1 added
// but left unused, exactly for this).

export type ShopOrderStatus = 'pending' | 'paid' | 'fulfilled' | 'cancelled' | 'refunded';
export type ShopOrderCurrency = 'gold' | 'claudium' | 'usd';
export type ShopSortDirection = 'asc' | 'desc';
export type ShopOrderSort = 'createdAt' | 'updatedAt' | 'totalAmount';

/** The stock effect a status transition applies, resolved once and reused by both the validator and the db layer. */
export type StockEffect =
  | 'reserve'
  | 'deductReservation'
  | 'releaseReservation'
  | 'restore'
  | 'none';

interface Transition {
  to: ShopOrderStatus;
  effect: StockEffect;
}

// The whole state machine in one place: every allowed (from -> to) pair and
// the stock effect it applies. `null` from-state represents order creation.
const TRANSITIONS: Record<string, Transition> = {
  'null->pending': { to: 'pending', effect: 'reserve' },
  'pending->paid': { to: 'paid', effect: 'deductReservation' },
  'pending->cancelled': { to: 'cancelled', effect: 'releaseReservation' },
  'paid->fulfilled': { to: 'fulfilled', effect: 'none' },
  'paid->cancelled': { to: 'cancelled', effect: 'restore' },
  'paid->refunded': { to: 'refunded', effect: 'restore' },
  'fulfilled->refunded': { to: 'refunded', effect: 'restore' },
};

/** The stock effect for a (from, to) pair, or null if the transition is not allowed. */
export function transitionEffect(
  from: ShopOrderStatus | null,
  to: ShopOrderStatus,
): StockEffect | null {
  const entry = TRANSITIONS[`${from}->${to}`];
  return entry && entry.to === to ? entry.effect : null;
}

export interface ShopOrderItemRecord {
  id: number;
  productId: number | null;
  productSku: string;
  productName: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
}

export interface ShopOrderStatusHistoryRecord {
  id: number;
  fromStatus: ShopOrderStatus | null;
  toStatus: ShopOrderStatus;
  adminAccountId: number | null;
  note: string;
  createdAt: string;
}

export interface ShopOrderRecord {
  id: number;
  accountId: number;
  accountUsername: string;
  status: ShopOrderStatus;
  currency: ShopOrderCurrency;
  totalAmount: number;
  note: string;
  createdByAdminId: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ShopOrderDetail extends ShopOrderRecord {
  items: ShopOrderItemRecord[];
  history: ShopOrderStatusHistoryRecord[];
}

export interface ShopOrderListParams {
  page: number;
  limit: number;
  q: string;
  status?: ShopOrderStatus;
  accountId?: number;
  sort: ShopOrderSort;
  dir: ShopSortDirection;
}

/** One requested line item, already shape-validated (positive integer quantity). */
export interface ShopOrderItemInput {
  productId: number;
  quantity: number;
}

export interface ShopOrderCreateInput {
  accountId: number;
  currency: ShopOrderCurrency;
  items: ShopOrderItemInput[];
  note: string;
}

export type ShopOrderErrorCode =
  | 'account_not_found'
  | 'empty_items'
  | 'product_not_found'
  | 'product_not_active'
  | 'price_not_set'
  | 'not_tracked'
  | 'insufficient_stock'
  | 'not_found'
  | 'invalid_transition';

export type ShopOrderResult =
  | { ok: true; order: ShopOrderDetail }
  | { ok: false; error: ShopOrderErrorCode; productId?: number };

/** The narrow account-existence + display-name read ShopOrdersService needs. */
export interface ShopAccountLookup {
  accountExists(id: number): Promise<{ id: number; username: string } | null>;
}

/** A resolved, priced line item the db layer inserts as one shop_order_items row. */
export interface ResolvedOrderItem {
  productId: number;
  productSku: string;
  productName: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
}

// Storage abstraction. The Postgres implementation (shop_orders_db.ts) owns ALL
// the SQL for the transactional operations below (spanning shop_orders,
// shop_order_items, shop_order_status_history, and shop_products/shop_inventory
// for pricing + stock effects), since a single business operation here touches
// more tables than any one sibling domain's own Db class can compose a
// transaction across. It does not modify a line of shop_products_db.ts /
// shop_inventory_db.ts; it reads/writes the same tables through its own fresh
// SQL, the same way shop_inventory_db.ts already joins shop_products for
// display columns.
export interface ShopOrdersDb {
  /**
   * Validate every line item (product exists + active + priced in `currency`
   * + trackable stock covers the quantity) and, if every item is valid,
   * atomically insert the order + items + reserve stock + write the initial
   * status_history row. Returns the specific line item's productId on a
   * per-item rejection (product_not_found/product_not_active/price_not_set/
   * not_tracked/insufficient_stock) so the caller can report which line failed.
   */
  createOrder(
    input: ShopOrderCreateInput,
    account: { id: number; username: string },
    createdByAdminId: number | null,
  ): Promise<
    | { ok: true; order: ShopOrderDetail }
    | {
        ok: false;
        error: Exclude<
          ShopOrderErrorCode,
          'account_not_found' | 'not_found' | 'invalid_transition'
        >;
        productId?: number;
      }
  >;
  getOrder(id: number): Promise<ShopOrderDetail | null>;
  listOrders(params: ShopOrderListParams): Promise<{ rows: ShopOrderRecord[]; total: number }>;
  /**
   * Apply an already-validated (from, to) transition atomically: update the
   * order's status, apply `effect` to every item's product inventory, and
   * append one status_history row. Returns null only if the order vanished
   * between the caller's read and this write (a benign race, treated as 404).
   */
  applyTransition(
    orderId: number,
    from: ShopOrderStatus,
    to: ShopOrderStatus,
    effect: StockEffect,
    adminAccountId: number | null,
    note: string,
  ): Promise<ShopOrderDetail | null>;
}

export function shopOrderJson(order: ShopOrderRecord): Record<string, unknown> {
  return { ...order };
}

export function shopOrderDetailJson(order: ShopOrderDetail): Record<string, unknown> {
  return { ...order };
}

export class ShopOrdersService {
  constructor(
    private readonly db: ShopOrdersDb,
    private readonly accounts: ShopAccountLookup,
  ) {}

  async createOrder(
    input: ShopOrderCreateInput,
    createdByAdminId: number | null,
  ): Promise<ShopOrderResult> {
    if (input.items.length === 0) return { ok: false, error: 'empty_items' };
    const account = await this.accounts.accountExists(input.accountId);
    if (!account) return { ok: false, error: 'account_not_found' };

    // Merge duplicate productIds (a cart-like input, not a strict line-item
    // list) so the same product listed twice sums to one reservation/line.
    const merged = new Map<number, number>();
    for (const item of input.items) {
      merged.set(item.productId, (merged.get(item.productId) ?? 0) + item.quantity);
    }
    const mergedItems: ShopOrderItemInput[] = [...merged.entries()].map(
      ([productId, quantity]) => ({
        productId,
        quantity,
      }),
    );

    const result = await this.db.createOrder(
      { ...input, items: mergedItems },
      account,
      createdByAdminId,
    );
    if (!result.ok) return result;
    return { ok: true, order: result.order };
  }

  getOrder(id: number): Promise<ShopOrderDetail | null> {
    return this.db.getOrder(id);
  }

  listOrders(params: ShopOrderListParams): Promise<{ rows: ShopOrderRecord[]; total: number }> {
    return this.db.listOrders(params);
  }

  private async transition(
    orderId: number,
    to: ShopOrderStatus,
    adminAccountId: number | null,
    note: string,
  ): Promise<ShopOrderResult> {
    const existing = await this.db.getOrder(orderId);
    if (!existing) return { ok: false, error: 'not_found' };
    const effect = transitionEffect(existing.status, to);
    if (!effect) return { ok: false, error: 'invalid_transition' };
    const updated = await this.db.applyTransition(
      orderId,
      existing.status,
      to,
      effect,
      adminAccountId,
      note,
    );
    if (!updated) return { ok: false, error: 'not_found' };
    return { ok: true, order: updated };
  }

  /** Generic status-change entry point (any allowed next status per the state machine). */
  updateStatus(
    orderId: number,
    to: ShopOrderStatus,
    adminAccountId: number | null,
    note: string,
  ): Promise<ShopOrderResult> {
    return this.transition(orderId, to, adminAccountId, note);
  }

  cancelOrder(
    orderId: number,
    adminAccountId: number | null,
    note: string,
  ): Promise<ShopOrderResult> {
    return this.transition(orderId, 'cancelled', adminAccountId, note);
  }

  refundOrder(
    orderId: number,
    adminAccountId: number | null,
    note: string,
  ): Promise<ShopOrderResult> {
    return this.transition(orderId, 'refunded', adminAccountId, note);
  }
}
