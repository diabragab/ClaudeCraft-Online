import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../server/claudium_proxy', () => ({ claudiumSpend: vi.fn() }));
vi.mock('../server/claudium', () => ({ grantWeaponSkinForShop: vi.fn() }));

import { grantWeaponSkinForShop } from '../server/claudium';
import { claudiumSpend } from '../server/claudium_proxy';
import {
  configureShopCheckoutRuntime,
  ShopClaudiumCheckoutService,
} from '../server/shop_claudium_checkout';
import type {
  ShopAccountLookup,
  ShopOrderCreateInput,
  ShopOrderDetail,
  ShopOrderItemRecord,
  ShopOrderRecord,
  ShopOrderStatus,
  ShopOrderStatusHistoryRecord,
  ShopOrdersDb,
  StockEffect,
} from '../server/shop_orders';
import { ShopOrdersService } from '../server/shop_orders';
import type { ShopCategoryLookup, ShopProductRecord, ShopProductsDb } from '../server/shop_products';
import { ShopProductsService } from '../server/shop_products';

const claudiumSpendMock = vi.mocked(claudiumSpend);
const grantWeaponSkinForShopMock = vi.mocked(grantWeaponSkinForShop);

// Minimal in-memory fakes mirroring the real Db contracts (server/CLAUDE.md:
// "Endpoint tests: FakeDb, not a pg-mock"), scoped to exactly what
// ShopClaudiumCheckoutService's orchestration calls: getProduct, createOrder,
// applyTransition (the pending->paid/cancelled path).
class FakeProductsDb implements ShopProductsDb {
  products = new Map<number, ShopProductRecord>();
  async insertProduct(): Promise<ShopProductRecord> {
    throw new Error('not used');
  }
  async getProduct(id: number): Promise<ShopProductRecord | null> {
    return this.products.get(id) ?? null;
  }
  async getProductBySlug(): Promise<ShopProductRecord | null> {
    throw new Error('not used');
  }
  async listProducts(): Promise<{ rows: ShopProductRecord[]; total: number }> {
    throw new Error('not used');
  }
  async updateProduct(): Promise<ShopProductRecord | null> {
    throw new Error('not used');
  }
  async deleteProduct(): Promise<boolean> {
    throw new Error('not used');
  }
}

class FakeCategoryLookup implements ShopCategoryLookup {
  async getCategory(): Promise<{ id: number } | null> {
    return null;
  }
}

class FakeOrdersDb implements ShopOrdersDb {
  orders: ShopOrderDetail[] = [];
  private nextOrderId = 1;
  private nextHistoryId = 1;
  productLookup = new Map<number, ShopProductRecord>();
  outOfStockProductIds = new Set<number>();

  async createOrder(
    input: ShopOrderCreateInput,
    account: { id: number; username: string },
    createdByAdminId: number | null,
  ) {
    const items: ShopOrderItemRecord[] = [];
    for (const item of input.items) {
      if (this.outOfStockProductIds.has(item.productId)) {
        return {
          ok: false as const,
          error: 'insufficient_stock' as const,
          productId: item.productId,
        };
      }
      const product = this.productLookup.get(item.productId);
      if (!product) {
        return {
          ok: false as const,
          error: 'product_not_found' as const,
          productId: item.productId,
        };
      }
      const unitPrice = product.priceClaudium ?? 0;
      items.push({
        id: items.length + 1,
        productId: item.productId,
        productSku: product.sku,
        productName: product.name,
        unitPrice,
        quantity: item.quantity,
        lineTotal: unitPrice * item.quantity,
      });
    }
    const totalAmount = items.reduce((sum, i) => sum + i.lineTotal, 0);
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
    return this.orders.find((o) => o.id === id) ?? null;
  }

  async listOrders(): Promise<{ rows: ShopOrderRecord[]; total: number }> {
    throw new Error('not used');
  }

  async applyTransition(
    orderId: number,
    from: ShopOrderStatus,
    to: ShopOrderStatus,
    _effect: StockEffect,
    adminAccountId: number | null,
    note: string,
  ): Promise<ShopOrderDetail | null> {
    const order = this.orders.find((o) => o.id === orderId);
    if (!order || order.status !== from) return null;
    order.status = to;
    order.history.push({
      id: this.nextHistoryId++,
      fromStatus: from,
      toStatus: to,
      adminAccountId,
      note,
      createdAt: new Date(1).toISOString(),
    });
    return order;
  }
}

class FakeAccountLookup implements ShopAccountLookup {
  async accountExists(id: number): Promise<{ id: number; username: string } | null> {
    return { id, username: `account-${id}` };
  }
}

const ACCOUNT_ID = 7;
const CHARACTER_ID = 42;

function baseProduct(overrides: Partial<ShopProductRecord> = {}): ShopProductRecord {
  return {
    id: 1,
    sku: 'armory_cinderbrand_sword',
    name: 'Cinderbrand Sword',
    slug: 'armory-cinderbrand-sword',
    description: '',
    categoryId: null,
    priceGoldCopper: null,
    priceClaudium: 200,
    priceUsdCents: null,
    railSol: false,
    railUsdc: false,
    railWoc: false,
    status: 'active',
    featured: false,
    grantKind: 'weapon_skin',
    grantItemId: 'cinderbrand_sword',
    grantQuantity: 1,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    ...overrides,
  };
}

function setup(): {
  productsDb: FakeProductsDb;
  ordersDb: FakeOrdersDb;
  svc: ShopClaudiumCheckoutService;
} {
  const productsDb = new FakeProductsDb();
  const ordersDb = new FakeOrdersDb();
  const products = new ShopProductsService(productsDb, new FakeCategoryLookup());
  const orders = new ShopOrdersService(ordersDb, new FakeAccountLookup());
  return { productsDb, ordersDb, svc: new ShopClaudiumCheckoutService(products, orders) };
}

describe('ShopClaudiumCheckoutService.purchase', () => {
  beforeEach(() => {
    claudiumSpendMock.mockReset();
    grantWeaponSkinForShopMock.mockReset();
    configureShopCheckoutRuntime({ mailItemToCharacter: vi.fn(() => true) });
  });

  it('rejects a product with no grant configured before creating any order', async () => {
    const { productsDb, ordersDb, svc } = setup();
    const product = baseProduct({ grantKind: 'none', grantItemId: null });
    productsDb.products.set(1, product);
    ordersDb.productLookup.set(1, product);

    const result = await svc.purchase({
      accountId: ACCOUNT_ID,
      characterId: CHARACTER_ID,
      productId: 1,
      quantity: 1,
    });

    expect(result).toEqual({ ok: false, error: 'not_deliverable' });
    expect(ordersDb.orders).toHaveLength(0);
    expect(claudiumSpendMock).not.toHaveBeenCalled();
  });

  it('returns not_found for a nonexistent product', async () => {
    const { svc } = setup();
    const result = await svc.purchase({
      accountId: ACCOUNT_ID,
      characterId: CHARACTER_ID,
      productId: 999,
      quantity: 1,
    });
    expect(result).toEqual({ ok: false, error: 'not_found' });
  });

  it('propagates an order-creation rejection (e.g. out of stock) without spending', async () => {
    const { productsDb, ordersDb, svc } = setup();
    const product = baseProduct();
    productsDb.products.set(1, product);
    ordersDb.outOfStockProductIds.add(1);

    const result = await svc.purchase({
      accountId: ACCOUNT_ID,
      characterId: CHARACTER_ID,
      productId: 1,
      quantity: 1,
    });

    expect(result).toEqual({ ok: false, error: 'insufficient_stock' });
    expect(claudiumSpendMock).not.toHaveBeenCalled();
  });

  it('charges Claudium, marks the order paid, and grants the weapon skin on success', async () => {
    const { productsDb, ordersDb, svc } = setup();
    const product = baseProduct();
    productsDb.products.set(1, product);
    ordersDb.productLookup.set(1, product);
    claudiumSpendMock.mockResolvedValue({
      granted: true,
      balance: 800,
      costClaudium: 200,
      reason: null,
    });

    const result = await svc.purchase({
      accountId: ACCOUNT_ID,
      characterId: CHARACTER_ID,
      productId: 1,
      quantity: 1,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.order.status).toBe('paid');
    expect(result.balance).toBe(800);
    expect(claudiumSpendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: ACCOUNT_ID,
        itemId: 'cinderbrand_sword',
        kind: 'skin',
        expectedCostClaudium: 200,
        idempotencyKey: `shop-order-${result.order.id}`,
      }),
    );
    expect(grantWeaponSkinForShopMock).toHaveBeenCalledWith(ACCOUNT_ID, 'cinderbrand_sword');
  });

  it("mails an item-kind grant to the buyer's live character on success", async () => {
    const { productsDb, ordersDb, svc } = setup();
    const product = baseProduct({
      grantKind: 'item',
      grantItemId: 'healing_potion',
      grantQuantity: 3,
    });
    productsDb.products.set(1, product);
    ordersDb.productLookup.set(1, product);
    claudiumSpendMock.mockResolvedValue({
      granted: true,
      balance: 500,
      costClaudium: 200,
      reason: null,
    });
    const mailItemToCharacter = vi.fn(() => true);
    configureShopCheckoutRuntime({ mailItemToCharacter });

    const result = await svc.purchase({
      accountId: ACCOUNT_ID,
      characterId: CHARACTER_ID,
      productId: 1,
      quantity: 2,
    });

    expect(result.ok).toBe(true);
    expect(mailItemToCharacter).toHaveBeenCalledWith(CHARACTER_ID, 'healing_potion', 6);
    expect(grantWeaponSkinForShopMock).not.toHaveBeenCalled();
  });

  it('cancels the pending order and reports insufficient_balance without granting anything', async () => {
    const { productsDb, ordersDb, svc } = setup();
    const product = baseProduct();
    productsDb.products.set(1, product);
    ordersDb.productLookup.set(1, product);
    claudiumSpendMock.mockResolvedValue({
      granted: false,
      balance: 50,
      costClaudium: 200,
      reason: 'insufficient_balance',
    });

    const result = await svc.purchase({
      accountId: ACCOUNT_ID,
      characterId: CHARACTER_ID,
      productId: 1,
      quantity: 1,
    });

    expect(result).toEqual({
      ok: false,
      error: 'insufficient_balance',
      balance: 50,
      costClaudium: 200,
    });
    expect(ordersDb.orders[0]?.status).toBe('cancelled');
    expect(grantWeaponSkinForShopMock).not.toHaveBeenCalled();
  });

  it('reports price_changed when the economy service rejects the expected cost', async () => {
    const { productsDb, ordersDb, svc } = setup();
    const product = baseProduct();
    productsDb.products.set(1, product);
    ordersDb.productLookup.set(1, product);
    claudiumSpendMock.mockResolvedValue({
      granted: false,
      balance: 1_000,
      costClaudium: 250,
      reason: 'price_changed',
    });

    const result = await svc.purchase({
      accountId: ACCOUNT_ID,
      characterId: CHARACTER_ID,
      productId: 1,
      quantity: 1,
    });

    expect(result).toEqual({
      ok: false,
      error: 'price_changed',
      balance: 1_000,
      costClaudium: 250,
    });
    expect(ordersDb.orders[0]?.status).toBe('cancelled');
  });

  it('reports spend_unavailable when the economy service is off', async () => {
    const { productsDb, ordersDb, svc } = setup();
    const product = baseProduct();
    productsDb.products.set(1, product);
    ordersDb.productLookup.set(1, product);
    claudiumSpendMock.mockResolvedValue({
      granted: false,
      balance: null,
      costClaudium: null,
      reason: 'unavailable',
    });

    const result = await svc.purchase({
      accountId: ACCOUNT_ID,
      characterId: CHARACTER_ID,
      productId: 1,
      quantity: 1,
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected rejection');
    expect(result.error).toBe('spend_unavailable');
    expect(ordersDb.orders[0]?.status).toBe('cancelled');
  });
});
