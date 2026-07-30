import { beforeEach, describe, expect, it } from 'vitest';
import type {
  ShopInventoryAdjustment,
  ShopInventoryDb,
  ShopInventoryListParams,
  ShopInventoryRecord,
  ShopInventoryWriteRow,
  ShopProductLookup,
} from '../server/shop_inventory';
import { ShopInventoryService } from '../server/shop_inventory';

interface AdjustmentLogRow {
  productId: number;
  quantityAfter: number;
  adjustment: ShopInventoryAdjustment;
}

// In-memory fake mirroring PgShopInventoryDb's contract, including the
// write-plus-adjustment atomicity (both land, or the test would see a row
// with no matching adjustment, which none of these cases produce).
class FakeShopInventoryDb implements ShopInventoryDb {
  private rows: ShopInventoryRecord[] = [];
  private nextId = 1;
  readonly adjustments: AdjustmentLogRow[] = [];

  private lookupProductDisplay(productId: number): { sku: string; name: string } {
    return { sku: `sku-${productId}`, name: `Product ${productId}` };
  }

  async insertInventory(
    row: ShopInventoryWriteRow,
    adjustment: ShopInventoryAdjustment | null,
  ): Promise<ShopInventoryRecord> {
    if (this.rows.some((r) => r.productId === row.productId)) {
      throw Object.assign(new Error('duplicate key value violates unique constraint'), {
        code: '23505',
      });
    }
    const display = this.lookupProductDisplay(row.productId);
    const record: ShopInventoryRecord = {
      id: this.nextId++,
      productId: row.productId,
      productSku: display.sku,
      productName: display.name,
      quantityOnHand: row.quantityOnHand,
      quantityReserved: row.quantityReserved,
      lowStockThreshold: row.lowStockThreshold,
      unlimited: row.unlimited,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    };
    this.rows.push(record);
    if (adjustment) {
      this.adjustments.push({
        productId: row.productId,
        quantityAfter: row.quantityOnHand,
        adjustment,
      });
    }
    return record;
  }

  async getInventory(id: number): Promise<ShopInventoryRecord | null> {
    return this.rows.find((r) => r.id === id) ?? null;
  }

  async getInventoryByProduct(productId: number): Promise<ShopInventoryRecord | null> {
    return this.rows.find((r) => r.productId === productId) ?? null;
  }

  async listInventory(
    params: ShopInventoryListParams,
  ): Promise<{ rows: ShopInventoryRecord[]; total: number }> {
    let filtered = this.rows.slice();
    if (params.q) {
      const q = params.q.toLowerCase();
      filtered = filtered.filter(
        (r) => r.productName.toLowerCase().includes(q) || r.productSku.toLowerCase().includes(q),
      );
    }
    if (params.lowStock) {
      filtered = filtered.filter((r) => !r.unlimited && r.quantityOnHand <= r.lowStockThreshold);
    }
    const dir = params.dir === 'asc' ? 1 : -1;
    filtered.sort((a, b) => {
      if (params.sort === 'quantity') return (a.quantityOnHand - b.quantityOnHand) * dir;
      return a.updatedAt.localeCompare(b.updatedAt) * dir;
    });
    const total = filtered.length;
    const offset = (params.page - 1) * params.limit;
    return { rows: filtered.slice(offset, offset + params.limit), total };
  }

  async updateInventory(
    id: number,
    patch: Partial<ShopInventoryWriteRow>,
    adjustment: ShopInventoryAdjustment | null,
  ): Promise<ShopInventoryRecord | null> {
    const row = this.rows.find((r) => r.id === id);
    if (!row) return null;
    Object.assign(row, patch);
    row.updatedAt = new Date(1).toISOString();
    if (adjustment) {
      this.adjustments.push({
        productId: row.productId,
        quantityAfter: row.quantityOnHand,
        adjustment,
      });
    }
    return row;
  }

  async deleteInventory(id: number): Promise<boolean> {
    const before = this.rows.length;
    this.rows = this.rows.filter((r) => r.id !== id);
    return this.rows.length < before;
  }
}

class FakeProductLookup implements ShopProductLookup {
  constructor(private readonly ids: Set<number>) {}
  async getProduct(id: number): Promise<{ id: number } | null> {
    return this.ids.has(id) ? { id } : null;
  }
}

function service(productIds: number[] = [1]): {
  db: FakeShopInventoryDb;
  svc: ShopInventoryService;
} {
  const db = new FakeShopInventoryDb();
  return { db, svc: new ShopInventoryService(db, new FakeProductLookup(new Set(productIds))) };
}

describe('ShopInventoryService', () => {
  let ctx: ReturnType<typeof service>;

  beforeEach(() => {
    ctx = service();
  });

  it('starts tracking a product and records the initial-stock adjustment', async () => {
    const result = await ctx.svc.createInventory(
      {
        productId: 1,
        quantityOnHand: 50,
        lowStockThreshold: 10,
        unlimited: false,
        reason: 'initial stock',
      },
      7,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.inventory.quantityOnHand).toBe(50);
      expect(result.inventory.productSku).toBe('sku-1');
    }
    expect(ctx.db.adjustments).toEqual([
      {
        productId: 1,
        quantityAfter: 50,
        adjustment: { delta: 50, reason: 'initial stock', adminAccountId: 7 },
      },
    ]);
  });

  it('records no adjustment when created with zero stock', async () => {
    await ctx.svc.createInventory(
      { productId: 1, quantityOnHand: 0, lowStockThreshold: 0, unlimited: false, reason: '' },
      7,
    );
    expect(ctx.db.adjustments).toEqual([]);
  });

  it('rejects tracking an unknown product', async () => {
    const result = await ctx.svc.createInventory(
      { productId: 999, quantityOnHand: 0, lowStockThreshold: 0, unlimited: false, reason: '' },
      null,
    );
    expect(result).toEqual({ ok: false, error: 'product_not_found' });
  });

  it('rejects tracking a product that already has an inventory row', async () => {
    await ctx.svc.createInventory(
      { productId: 1, quantityOnHand: 0, lowStockThreshold: 0, unlimited: false, reason: '' },
      null,
    );
    const result = await ctx.svc.createInventory(
      { productId: 1, quantityOnHand: 5, lowStockThreshold: 0, unlimited: false, reason: '' },
      null,
    );
    expect(result).toEqual({ ok: false, error: 'already_tracked' });
  });

  it('adjusts stock on update and records the delta', async () => {
    const created = await ctx.svc.createInventory(
      { productId: 1, quantityOnHand: 20, lowStockThreshold: 5, unlimited: false, reason: '' },
      null,
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const updated = await ctx.svc.updateInventory(
      created.inventory.id,
      { quantityOnHand: 12, reason: 'sold 8' },
      3,
    );
    expect(updated.ok).toBe(true);
    if (updated.ok) expect(updated.inventory.quantityOnHand).toBe(12);
    expect(ctx.db.adjustments.at(-1)).toEqual({
      productId: 1,
      quantityAfter: 12,
      adjustment: { delta: -8, reason: 'sold 8', adminAccountId: 3 },
    });
  });

  it('records no adjustment when a non-quantity field changes', async () => {
    // quantityOnHand: 0 at creation records no initial-stock adjustment
    // (see the "records no adjustment when created with zero stock" case
    // above), so the log stays empty through a lowStockThreshold-only update.
    const created = await ctx.svc.createInventory(
      { productId: 1, quantityOnHand: 0, lowStockThreshold: 5, unlimited: false, reason: '' },
      null,
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    await ctx.svc.updateInventory(created.inventory.id, { lowStockThreshold: 8 }, 3);
    expect(ctx.db.adjustments).toEqual([]);
  });

  it('rejects a negative quantityOnHand', async () => {
    const created = await ctx.svc.createInventory(
      { productId: 1, quantityOnHand: 5, lowStockThreshold: 0, unlimited: false, reason: '' },
      null,
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const result = await ctx.svc.updateInventory(
      created.inventory.id,
      { quantityOnHand: -1 },
      null,
    );
    expect(result).toEqual({ ok: false, error: 'invalid_quantity' });
  });

  it('returns not_found when updating a missing inventory row', async () => {
    const result = await ctx.svc.updateInventory(999, { quantityOnHand: 1 }, null);
    expect(result).toEqual({ ok: false, error: 'not_found' });
  });

  it('filters the list to low-stock rows', async () => {
    await ctx.svc.createInventory(
      { productId: 1, quantityOnHand: 2, lowStockThreshold: 10, unlimited: false, reason: '' },
      null,
    );
    // A second, well-stocked product row via the same fake db (no service
    // validation needed here since the row is inserted directly).
    await ctx.db.insertInventory(
      {
        productId: 2,
        quantityOnHand: 100,
        quantityReserved: 0,
        lowStockThreshold: 5,
        unlimited: false,
      },
      null,
    );
    const { rows, total } = await ctx.svc.listInventory({
      page: 1,
      limit: 20,
      q: '',
      lowStock: true,
      sort: 'quantity',
      dir: 'asc',
    });
    expect(total).toBe(1);
    expect(rows[0].productId).toBe(1);
  });

  it('deletes an inventory row', async () => {
    const created = await ctx.svc.createInventory(
      { productId: 1, quantityOnHand: 0, lowStockThreshold: 0, unlimited: false, reason: '' },
      null,
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(await ctx.svc.deleteInventory(created.inventory.id)).toBe(true);
    expect(await ctx.svc.getInventory(created.inventory.id)).toBeNull();
  });
});
