import { beforeEach, describe, expect, it } from 'vitest';
import type {
  ShopAccountLookup,
  ShopOrderCreateInput,
  ShopOrderDetail,
  ShopOrderItemRecord,
  ShopOrderListParams,
  ShopOrderRecord,
  ShopOrderStatus,
  ShopOrderStatusHistoryRecord,
  ShopOrdersDb,
  StockEffect,
} from '../server/shop_orders';
import { ShopOrdersService, transitionEffect } from '../server/shop_orders';

interface FakeProduct {
  id: number;
  status: 'draft' | 'active' | 'archived';
  priceGoldCopper: number | null;
  priceClaudium: number | null;
  priceUsdCents: number | null;
  discountPercent?: number | null;
  sku: string;
  name: string;
}

interface FakeInventory {
  onHand: number;
  reserved: number;
  unlimited: boolean;
}

// In-memory fake mirroring PgShopOrdersDb's contract (see server/CLAUDE.md:
// "Endpoint tests: FakeDb, not a pg-mock"). Unlike the products/categories
// fakes, this one also models the products + inventory rows the real
// PgShopOrdersDb reads/writes directly (server/shop_orders_db.ts's header:
// it owns its own SQL against those tables rather than composing the
// sibling Db classes), so the fake replicates the same validation and stock
// effects to exercise the service meaningfully.
class FakeShopOrdersDb implements ShopOrdersDb {
  products = new Map<number, FakeProduct>();
  inventory = new Map<number, FakeInventory>();
  orders: ShopOrderDetail[] = [];
  private nextOrderId = 1;
  private nextItemId = 1;
  private nextHistoryId = 1;

  private priceFor(
    product: FakeProduct,
    currency: ShopOrderCreateInput['currency'],
  ): number | null {
    if (currency === 'gold') return product.priceGoldCopper;
    if (currency === 'claudium') return product.priceClaudium;
    return product.priceUsdCents;
  }

  async createOrder(
    input: ShopOrderCreateInput,
    account: { id: number; username: string },
    createdByAdminId: number | null,
  ) {
    const resolved: {
      productId: number;
      productSku: string;
      productName: string;
      unitPrice: number;
      quantity: number;
      lineTotal: number;
    }[] = [];
    for (const item of input.items) {
      const product = this.products.get(item.productId);
      if (!product)
        return {
          ok: false as const,
          error: 'product_not_found' as const,
          productId: item.productId,
        };
      if (product.status !== 'active') {
        return {
          ok: false as const,
          error: 'product_not_active' as const,
          productId: item.productId,
        };
      }
      const rawUnitPrice = this.priceFor(product, input.currency);
      if (rawUnitPrice === null) {
        return { ok: false as const, error: 'price_not_set' as const, productId: item.productId };
      }
      const discountPercent = product.discountPercent ?? null;
      const unitPrice =
        discountPercent === null
          ? rawUnitPrice
          : Math.round((rawUnitPrice * (100 - discountPercent)) / 100);
      const inv = this.inventory.get(item.productId);
      if (!inv)
        return { ok: false as const, error: 'not_tracked' as const, productId: item.productId };
      if (!inv.unlimited && inv.onHand - inv.reserved < item.quantity) {
        return {
          ok: false as const,
          error: 'insufficient_stock' as const,
          productId: item.productId,
        };
      }
      resolved.push({
        productId: item.productId,
        productSku: product.sku,
        productName: product.name,
        unitPrice,
        quantity: item.quantity,
        lineTotal: unitPrice * item.quantity,
      });
    }

    const totalAmount = resolved.reduce((sum, item) => sum + item.lineTotal, 0);
    const items: ShopOrderItemRecord[] = resolved.map((r) => ({ id: this.nextItemId++, ...r }));
    for (const item of resolved) {
      const inv = this.inventory.get(item.productId);
      if (inv && !inv.unlimited) inv.reserved += item.quantity;
    }
    const history: ShopOrderStatusHistoryRecord = {
      id: this.nextHistoryId++,
      fromStatus: null,
      toStatus: 'pending',
      adminAccountId: createdByAdminId,
      note: input.note,
      createdAt: new Date(0).toISOString(),
    };
    const order: ShopOrderDetail = {
      id: this.nextOrderId++,
      accountId: account.id,
      accountUsername: account.username,
      status: 'pending',
      currency: input.currency,
      totalAmount,
      note: input.note,
      createdByAdminId,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
      items,
      history: [history],
    };
    this.orders.push(order);
    return { ok: true as const, order };
  }

  async getOrder(id: number): Promise<ShopOrderDetail | null> {
    const order = this.orders.find((o) => o.id === id);
    return order ? { ...order, items: [...order.items], history: [...order.history] } : null;
  }

  async listOrders(
    params: ShopOrderListParams,
  ): Promise<{ rows: ShopOrderRecord[]; total: number }> {
    let filtered = this.orders.slice();
    if (params.q) {
      const q = params.q.toLowerCase();
      filtered = filtered.filter(
        (o) => o.accountUsername.toLowerCase().includes(q) || o.note.toLowerCase().includes(q),
      );
    }
    if (params.status !== undefined) filtered = filtered.filter((o) => o.status === params.status);
    if (params.accountId !== undefined) {
      filtered = filtered.filter((o) => o.accountId === params.accountId);
    }
    const dir = params.dir === 'asc' ? 1 : -1;
    filtered.sort((a, b) => {
      if (params.sort === 'totalAmount') return (a.totalAmount - b.totalAmount) * dir;
      if (params.sort === 'updatedAt') return a.updatedAt.localeCompare(b.updatedAt) * dir;
      return a.createdAt.localeCompare(b.createdAt) * dir;
    });
    const total = filtered.length;
    const offset = (params.page - 1) * params.limit;
    const rows: ShopOrderRecord[] = filtered.slice(offset, offset + params.limit).map((o) => {
      const { items: _items, history: _history, ...rec } = o;
      return rec;
    });
    return { rows, total };
  }

  async applyTransition(
    orderId: number,
    from: ShopOrderStatus,
    to: ShopOrderStatus,
    effect: StockEffect,
    adminAccountId: number | null,
    note: string,
  ): Promise<ShopOrderDetail | null> {
    const order = this.orders.find((o) => o.id === orderId);
    if (!order || order.status !== from) return null;
    for (const item of order.items) {
      if (item.productId === null) continue;
      const inv = this.inventory.get(item.productId);
      if (!inv || inv.unlimited) continue;
      if (effect === 'reserve') inv.reserved += item.quantity;
      else if (effect === 'deductReservation') {
        inv.onHand -= item.quantity;
        inv.reserved -= item.quantity;
      } else if (effect === 'releaseReservation') inv.reserved -= item.quantity;
      else if (effect === 'restore') inv.onHand += item.quantity;
    }
    order.status = to;
    order.updatedAt = new Date(1).toISOString();
    order.history.push({
      id: this.nextHistoryId++,
      fromStatus: from,
      toStatus: to,
      adminAccountId,
      note,
      createdAt: new Date(1).toISOString(),
    });
    return { ...order, items: [...order.items], history: [...order.history] };
  }
}

class FakeAccountLookup implements ShopAccountLookup {
  constructor(private readonly accounts: Map<number, string>) {}
  async accountExists(id: number): Promise<{ id: number; username: string } | null> {
    const username = this.accounts.get(id);
    return username ? { id, username } : null;
  }
}

const ACCOUNT_ID = 7;

function setup(): { db: FakeShopOrdersDb; svc: ShopOrdersService } {
  const db = new FakeShopOrdersDb();
  db.products.set(1, {
    id: 1,
    status: 'active',
    priceGoldCopper: 100,
    priceClaudium: null,
    priceUsdCents: null,
    sku: 'sword-01',
    name: 'Iron Sword',
  });
  db.inventory.set(1, { onHand: 10, reserved: 0, unlimited: false });
  const accounts = new Map([[ACCOUNT_ID, 'playerOne']]);
  return { db, svc: new ShopOrdersService(db, new FakeAccountLookup(accounts)) };
}

const BASE_CREATE: ShopOrderCreateInput = {
  accountId: ACCOUNT_ID,
  currency: 'gold',
  items: [{ productId: 1, quantity: 2 }],
  note: '',
};

describe('ShopOrdersService.createOrder', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });

  it('creates a pending order and reserves stock', async () => {
    const result = await ctx.svc.createOrder(BASE_CREATE, 9);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.order.status).toBe('pending');
    expect(result.order.totalAmount).toBe(200);
    expect(result.order.items).toHaveLength(1);
    expect(result.order.items[0].quantity).toBe(2);
    expect(result.order.items[0].lineTotal).toBe(200);
    expect(result.order.accountUsername).toBe('playerOne');
    expect(result.order.createdByAdminId).toBe(9);
    expect(ctx.db.inventory.get(1)?.reserved).toBe(2);
    expect(ctx.db.inventory.get(1)?.onHand).toBe(10); // on-hand untouched at creation
  });

  it('prices a discounted product at the discounted total, not the sticker price', async () => {
    ctx.db.products.set(2, {
      id: 2,
      status: 'active',
      priceGoldCopper: 100,
      priceClaudium: null,
      priceUsdCents: null,
      discountPercent: 30,
      sku: 'shield-01',
      name: 'Iron Shield',
    });
    ctx.db.inventory.set(2, { onHand: 10, reserved: 0, unlimited: false });

    const result = await ctx.svc.createOrder(
      { ...BASE_CREATE, items: [{ productId: 2, quantity: 2 }] },
      9,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 100 gold at 30% off is 70/unit, 140 for two, never the undiscounted 200.
    expect(result.order.items[0].unitPrice).toBe(70);
    expect(result.order.totalAmount).toBe(140);
  });

  it('merges duplicate productIds into one line item, summing quantity', async () => {
    const result = await ctx.svc.createOrder(
      {
        ...BASE_CREATE,
        items: [
          { productId: 1, quantity: 2 },
          { productId: 1, quantity: 3 },
        ],
      },
      null,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.order.items).toHaveLength(1);
    expect(result.order.items[0].quantity).toBe(5);
    expect(ctx.db.inventory.get(1)?.reserved).toBe(5);
  });

  it('rejects an empty items array before touching the account or db', async () => {
    const result = await ctx.svc.createOrder({ ...BASE_CREATE, items: [] }, null);
    expect(result).toEqual({ ok: false, error: 'empty_items' });
  });

  it('rejects an unknown account', async () => {
    const result = await ctx.svc.createOrder({ ...BASE_CREATE, accountId: 999 }, null);
    expect(result).toEqual({ ok: false, error: 'account_not_found' });
  });

  it('rejects an unknown product', async () => {
    const result = await ctx.svc.createOrder(
      { ...BASE_CREATE, items: [{ productId: 999, quantity: 1 }] },
      null,
    );
    expect(result).toEqual({ ok: false, error: 'product_not_found', productId: 999 });
  });

  it('rejects a non-active product', async () => {
    ctx.db.products.set(1, { ...(ctx.db.products.get(1) as FakeProduct), status: 'draft' });
    const result = await ctx.svc.createOrder(BASE_CREATE, null);
    expect(result).toEqual({ ok: false, error: 'product_not_active', productId: 1 });
  });

  it('rejects a currency with no price set on the product', async () => {
    const result = await ctx.svc.createOrder({ ...BASE_CREATE, currency: 'usd' }, null);
    expect(result).toEqual({ ok: false, error: 'price_not_set', productId: 1 });
  });

  it('rejects a product with no inventory row (untracked, unorderable)', async () => {
    ctx.db.inventory.delete(1);
    const result = await ctx.svc.createOrder(BASE_CREATE, null);
    expect(result).toEqual({ ok: false, error: 'not_tracked', productId: 1 });
  });

  it('rejects insufficient stock (available = onHand - reserved)', async () => {
    ctx.db.inventory.set(1, { onHand: 1, reserved: 0, unlimited: false });
    const result = await ctx.svc.createOrder(BASE_CREATE, null); // quantity 2 > available 1
    expect(result).toEqual({ ok: false, error: 'insufficient_stock', productId: 1 });
  });

  it('allows an unlimited product to bypass the stock check', async () => {
    ctx.db.inventory.set(1, { onHand: 0, reserved: 0, unlimited: true });
    const result = await ctx.svc.createOrder(BASE_CREATE, null);
    expect(result.ok).toBe(true);
    expect(ctx.db.inventory.get(1)?.reserved).toBe(0); // unlimited: never reserved
  });
});

describe('ShopOrdersService status transitions', () => {
  let ctx: ReturnType<typeof setup>;
  let orderId: number;

  beforeEach(async () => {
    ctx = setup();
    const created = await ctx.svc.createOrder(BASE_CREATE, null);
    if (!created.ok) throw new Error('setup failed');
    orderId = created.order.id;
  });

  it('pending -> paid deducts on-hand and clears the reservation', async () => {
    const result = await ctx.svc.updateStatus(orderId, 'paid', 5, 'paid via wire');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.order.status).toBe('paid');
    expect(ctx.db.inventory.get(1)).toEqual({ onHand: 8, reserved: 0, unlimited: false });
  });

  it('pending -> cancelled releases the reservation without touching on-hand', async () => {
    const result = await ctx.svc.cancelOrder(orderId, 5, 'changed mind');
    expect(result.ok).toBe(true);
    expect(ctx.db.inventory.get(1)).toEqual({ onHand: 10, reserved: 0, unlimited: false });
  });

  it('paid -> fulfilled has no stock effect', async () => {
    await ctx.svc.updateStatus(orderId, 'paid', 5, '');
    const result = await ctx.svc.updateStatus(orderId, 'fulfilled', 5, 'shipped');
    expect(result.ok).toBe(true);
    expect(ctx.db.inventory.get(1)).toEqual({ onHand: 8, reserved: 0, unlimited: false });
  });

  it('paid -> cancelled restores on-hand', async () => {
    await ctx.svc.updateStatus(orderId, 'paid', 5, '');
    const result = await ctx.svc.cancelOrder(orderId, 5, 'refund by cancel');
    expect(result.ok).toBe(true);
    expect(ctx.db.inventory.get(1)).toEqual({ onHand: 10, reserved: 0, unlimited: false });
  });

  it('paid -> refunded restores on-hand', async () => {
    await ctx.svc.updateStatus(orderId, 'paid', 5, '');
    const result = await ctx.svc.refundOrder(orderId, 5, 'refunded');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.order.status).toBe('refunded');
    expect(ctx.db.inventory.get(1)).toEqual({ onHand: 10, reserved: 0, unlimited: false });
  });

  it('fulfilled -> refunded restores on-hand', async () => {
    await ctx.svc.updateStatus(orderId, 'paid', 5, '');
    await ctx.svc.updateStatus(orderId, 'fulfilled', 5, '');
    const result = await ctx.svc.refundOrder(orderId, 5, 'refunded after fulfillment');
    expect(result.ok).toBe(true);
    expect(ctx.db.inventory.get(1)).toEqual({ onHand: 10, reserved: 0, unlimited: false });
  });

  it('rejects a disallowed transition (pending -> fulfilled)', async () => {
    const result = await ctx.svc.updateStatus(orderId, 'fulfilled', 5, '');
    expect(result).toEqual({ ok: false, error: 'invalid_transition' });
  });

  it('rejects a disallowed transition (cancelled -> paid, a terminal state)', async () => {
    await ctx.svc.cancelOrder(orderId, 5, '');
    const result = await ctx.svc.updateStatus(orderId, 'paid', 5, '');
    expect(result).toEqual({ ok: false, error: 'invalid_transition' });
  });

  it('returns not_found for a missing order', async () => {
    const result = await ctx.svc.updateStatus(999, 'paid', 5, '');
    expect(result).toEqual({ ok: false, error: 'not_found' });
  });

  it('records a status history entry for every transition', async () => {
    await ctx.svc.updateStatus(orderId, 'paid', 5, 'paid note');
    const order = await ctx.svc.getOrder(orderId);
    expect(order?.history).toHaveLength(2);
    expect(order?.history[0]).toMatchObject({ fromStatus: null, toStatus: 'pending' });
    expect(order?.history[1]).toMatchObject({
      fromStatus: 'pending',
      toStatus: 'paid',
      adminAccountId: 5,
      note: 'paid note',
    });
  });
});

describe('ShopOrdersService.listOrders', () => {
  it('filters by status and account, sorts, and paginates', async () => {
    const ctx = setup();
    ctx.db.products.set(2, {
      id: 2,
      status: 'active',
      priceGoldCopper: 50,
      priceClaudium: null,
      priceUsdCents: null,
      sku: 'shield-01',
      name: 'Wooden Shield',
    });
    ctx.db.inventory.set(2, { onHand: 100, reserved: 0, unlimited: false });

    const first = await ctx.svc.createOrder(
      { accountId: ACCOUNT_ID, currency: 'gold', items: [{ productId: 1, quantity: 1 }], note: '' },
      null,
    );
    const second = await ctx.svc.createOrder(
      { accountId: ACCOUNT_ID, currency: 'gold', items: [{ productId: 2, quantity: 1 }], note: '' },
      null,
    );
    if (!first.ok || !second.ok) throw new Error('setup failed');
    await ctx.svc.updateStatus(second.order.id, 'paid', null, '');

    const { rows, total } = await ctx.svc.listOrders({
      page: 1,
      limit: 20,
      q: '',
      status: 'paid',
      accountId: ACCOUNT_ID,
      sort: 'totalAmount',
      dir: 'asc',
    });
    expect(total).toBe(1);
    expect(rows[0].id).toBe(second.order.id);
    expect(rows[0].status).toBe('paid');
  });
});

describe('transitionEffect (the state machine table)', () => {
  it('resolves every documented transition to its stock effect', () => {
    expect(transitionEffect(null, 'pending')).toBe('reserve');
    expect(transitionEffect('pending', 'paid')).toBe('deductReservation');
    expect(transitionEffect('pending', 'cancelled')).toBe('releaseReservation');
    expect(transitionEffect('paid', 'fulfilled')).toBe('none');
    expect(transitionEffect('paid', 'cancelled')).toBe('restore');
    expect(transitionEffect('paid', 'refunded')).toBe('restore');
    expect(transitionEffect('fulfilled', 'refunded')).toBe('restore');
  });

  it('rejects every undocumented transition', () => {
    expect(transitionEffect('pending', 'fulfilled')).toBeNull();
    expect(transitionEffect('pending', 'refunded')).toBeNull();
    expect(transitionEffect('cancelled', 'paid')).toBeNull();
    expect(transitionEffect('refunded', 'paid')).toBeNull();
    expect(transitionEffect('fulfilled', 'paid')).toBeNull();
    expect(transitionEffect(null, 'paid')).toBeNull();
  });
});
