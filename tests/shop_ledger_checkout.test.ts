import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../server/claudium', () => ({ grantWeaponSkinForShop: vi.fn() }));

import { grantWeaponSkinForShop } from '../server/claudium';
import { ClaudiumLedgerService } from '../server/claudium_ledger';
import type {
  ClaudiumDebitResult,
  ClaudiumHistoryEntry,
  ClaudiumLedgerDb,
} from '../server/claudium_ledger_db';
import type {
  ShopAnnouncementPurchase,
  ShopAnnouncementService,
} from '../server/shop_announcement';
import { configureShopDeliveryRuntime } from '../server/shop_delivery';
import { ShopLedgerCheckoutService } from '../server/shop_ledger_checkout';
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
import type {
  ShopCategoryLookup,
  ShopProductRecord,
  ShopProductsDb,
} from '../server/shop_products';
import { ShopProductsService } from '../server/shop_products';

const grantWeaponSkinForShopMock = vi.mocked(grantWeaponSkinForShop);

// Minimal in-memory fakes mirroring the real Db contracts (server/CLAUDE.md:
// "Endpoint tests: FakeDb, not a pg-mock"), scoped to exactly what
// ShopLedgerCheckoutService's orchestration calls: getProduct, createOrder,
// applyTransition (the pending->paid/cancelled path), plus a FakeClaudiumLedgerDb
// for the debit itself.
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

class FakeClaudiumLedgerDb implements ClaudiumLedgerDb {
  balances = new Map<number, number>();

  async getBalance(accountId: number): Promise<number> {
    return this.balances.get(accountId) ?? 0;
  }

  async addBalance(accountId: number, amount: number): Promise<number> {
    const balance = (this.balances.get(accountId) ?? 0) + amount;
    this.balances.set(accountId, balance);
    return balance;
  }

  async removeBalance(accountId: number, amount: number): Promise<ClaudiumDebitResult> {
    const current = this.balances.get(accountId) ?? 0;
    if (current < amount) return { ok: false, error: 'insufficient_balance' };
    const balance = current - amount;
    this.balances.set(accountId, balance);
    return { ok: true, balance };
  }

  async getHistory(): Promise<ClaudiumHistoryEntry[]> {
    return [];
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
    icon: null,
    displayOrder: 0,
    grantKind: 'weapon_skin',
    grantItemId: 'cinderbrand_sword',
    grantQuantity: 1,
    rarity: 'common',
    badges: [],
    isEvent: false,
    isLimited: false,
    discountPercent: null,
    bannerImage: null,
    previewImage: null,
    announcementTemplate: null,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    ...overrides,
  };
}

function setup(): {
  productsDb: FakeProductsDb;
  ordersDb: FakeOrdersDb;
  ledgerDb: FakeClaudiumLedgerDb;
  svc: ShopLedgerCheckoutService;
} {
  const productsDb = new FakeProductsDb();
  const ordersDb = new FakeOrdersDb();
  const ledgerDb = new FakeClaudiumLedgerDb();
  const products = new ShopProductsService(productsDb, new FakeCategoryLookup());
  const orders = new ShopOrdersService(ordersDb, new FakeAccountLookup());
  const ledger = new ClaudiumLedgerService(ledgerDb);
  return {
    productsDb,
    ordersDb,
    ledgerDb,
    svc: new ShopLedgerCheckoutService(products, orders, ledger),
  };
}

describe('ShopLedgerCheckoutService.purchase', () => {
  beforeEach(() => {
    grantWeaponSkinForShopMock.mockReset();
    configureShopDeliveryRuntime({ mailItemToCharacter: vi.fn(() => true) });
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

  it('propagates an order-creation rejection (e.g. out of stock) without touching the ledger', async () => {
    const { productsDb, ordersDb, ledgerDb, svc } = setup();
    const product = baseProduct();
    productsDb.products.set(1, product);
    ordersDb.outOfStockProductIds.add(1);
    ledgerDb.balances.set(ACCOUNT_ID, 999_999);

    const result = await svc.purchase({
      accountId: ACCOUNT_ID,
      characterId: CHARACTER_ID,
      productId: 1,
      quantity: 1,
    });

    expect(result).toEqual({ ok: false, error: 'insufficient_stock' });
    expect(await ledgerDb.getBalance(ACCOUNT_ID)).toBe(999_999);
  });

  it('deducts the exact order total, marks the order paid, and grants the weapon skin on success', async () => {
    const { productsDb, ordersDb, ledgerDb, svc } = setup();
    const product = baseProduct({ priceClaudium: 200 });
    productsDb.products.set(1, product);
    ordersDb.productLookup.set(1, product);
    ledgerDb.balances.set(ACCOUNT_ID, 5_000);

    const result = await svc.purchase({
      accountId: ACCOUNT_ID,
      characterId: CHARACTER_ID,
      productId: 1,
      quantity: 1,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.order.status).toBe('paid');
    expect(result.balance).toBe(4_800);
    expect(await ledgerDb.getBalance(ACCOUNT_ID)).toBe(4_800);
    expect(grantWeaponSkinForShopMock).toHaveBeenCalledWith(ACCOUNT_ID, 'cinderbrand_sword');
  });

  it("mails an item-kind grant to the buyer's live character on success, scaled by quantity", async () => {
    const { productsDb, ordersDb, ledgerDb, svc } = setup();
    const product = baseProduct({
      grantKind: 'item',
      grantItemId: 'healing_potion',
      grantQuantity: 3,
      priceClaudium: 50,
    });
    productsDb.products.set(1, product);
    ordersDb.productLookup.set(1, product);
    ledgerDb.balances.set(ACCOUNT_ID, 10_000);
    const mailItemToCharacter = vi.fn(() => true);
    configureShopDeliveryRuntime({ mailItemToCharacter });

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

  it('cancels the pending order and reports insufficient_claudium without granting anything', async () => {
    const { productsDb, ordersDb, ledgerDb, svc } = setup();
    const product = baseProduct({ priceClaudium: 200 });
    productsDb.products.set(1, product);
    ordersDb.productLookup.set(1, product);
    ledgerDb.balances.set(ACCOUNT_ID, 50);

    const result = await svc.purchase({
      accountId: ACCOUNT_ID,
      characterId: CHARACTER_ID,
      productId: 1,
      quantity: 1,
    });

    expect(result).toEqual({ ok: false, error: 'insufficient_claudium', balance: null });
    expect(ordersDb.orders[0]?.status).toBe('cancelled');
    expect(await ledgerDb.getBalance(ACCOUNT_ID)).toBe(50);
    expect(grantWeaponSkinForShopMock).not.toHaveBeenCalled();
  });

  it('announces a successful purchase (Phase 2D) when a characterName is given', async () => {
    const { productsDb, ordersDb, ledgerDb } = setup();
    const product = baseProduct({ priceClaudium: 200, rarity: 'legendary' });
    productsDb.products.set(1, product);
    ordersDb.productLookup.set(1, product);
    ledgerDb.balances.set(ACCOUNT_ID, 1_000);
    const announcePurchase = vi.fn<(purchase: ShopAnnouncementPurchase) => Promise<void>>(
      async () => undefined,
    );
    const announcer = { announcePurchase } as unknown as ShopAnnouncementService;
    const products = new ShopProductsService(productsDb, new FakeCategoryLookup());
    const orders = new ShopOrdersService(ordersDb, new FakeAccountLookup());
    const ledger = new ClaudiumLedgerService(ledgerDb);
    const svc = new ShopLedgerCheckoutService(products, orders, ledger, announcer);

    const result = await svc.purchase({
      accountId: ACCOUNT_ID,
      characterId: CHARACTER_ID,
      productId: 1,
      quantity: 1,
      characterName: 'Aria',
    });

    expect(result.ok).toBe(true);
    expect(announcePurchase).toHaveBeenCalledWith({
      playerName: 'Aria',
      productName: 'Cinderbrand Sword',
      rarity: 'legendary',
    });
  });

  it('skips the announcement when no characterName is given (existing 3-arg callers)', async () => {
    const { productsDb, ordersDb, ledgerDb, svc } = setup();
    const product = baseProduct({ priceClaudium: 200 });
    productsDb.products.set(1, product);
    ordersDb.productLookup.set(1, product);
    ledgerDb.balances.set(ACCOUNT_ID, 1_000);

    const result = await svc.purchase({
      accountId: ACCOUNT_ID,
      characterId: CHARACTER_ID,
      productId: 1,
      quantity: 1,
    });

    expect(result.ok).toBe(true);
  });
});
