import { beforeEach, describe, expect, it } from 'vitest';
import type {
  ShopCategoryLookup,
  ShopProductCreateInput,
  ShopProductListParams,
  ShopProductRecord,
  ShopProductsDb,
  ShopProductWriteRow,
} from '../server/shop_products';
import { ShopProductsService } from '../server/shop_products';

// In-memory fakes mirroring PgShopProductsDb / PgShopCategoriesDb's contracts
// (see server/CLAUDE.md: "Endpoint tests: FakeDb, not a pg-mock").
class FakeShopProductsDb implements ShopProductsDb {
  private rows: ShopProductRecord[] = [];
  private nextId = 1;

  async insertProduct(row: ShopProductWriteRow): Promise<ShopProductRecord> {
    if (this.rows.some((r) => r.sku === row.sku || r.slug === row.slug)) {
      throw Object.assign(new Error('duplicate key value violates unique constraint'), {
        code: '23505',
      });
    }
    const record: ShopProductRecord = {
      id: this.nextId++,
      ...row,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    };
    this.rows.push(record);
    return record;
  }

  async getProduct(id: number): Promise<ShopProductRecord | null> {
    return this.rows.find((r) => r.id === id) ?? null;
  }

  async getProductBySlug(slug: string): Promise<ShopProductRecord | null> {
    return this.rows.find((r) => r.slug === slug) ?? null;
  }

  async listProducts(
    params: ShopProductListParams,
  ): Promise<{ rows: ShopProductRecord[]; total: number }> {
    let filtered = this.rows.slice();
    if (params.q) {
      const q = params.q.toLowerCase();
      filtered = filtered.filter(
        (r) => r.name.toLowerCase().includes(q) || r.sku.toLowerCase().includes(q),
      );
    }
    if (params.categoryId !== undefined) {
      filtered = filtered.filter((r) =>
        params.categoryId === 0 ? r.categoryId === null : r.categoryId === params.categoryId,
      );
    }
    if (params.status !== undefined) filtered = filtered.filter((r) => r.status === params.status);
    const dir = params.dir === 'asc' ? 1 : -1;
    filtered.sort((a, b) => {
      if (params.sort === 'name') return a.name.localeCompare(b.name) * dir;
      if (params.sort === 'createdAt') return a.createdAt.localeCompare(b.createdAt) * dir;
      return a.updatedAt.localeCompare(b.updatedAt) * dir;
    });
    const total = filtered.length;
    const offset = (params.page - 1) * params.limit;
    return { rows: filtered.slice(offset, offset + params.limit), total };
  }

  async updateProduct(
    id: number,
    patch: Partial<ShopProductWriteRow>,
  ): Promise<ShopProductRecord | null> {
    const row = this.rows.find((r) => r.id === id);
    if (!row) return null;
    Object.assign(row, patch);
    row.updatedAt = new Date(1).toISOString();
    return row;
  }

  async deleteProduct(id: number): Promise<boolean> {
    const before = this.rows.length;
    this.rows = this.rows.filter((r) => r.id !== id);
    return this.rows.length < before;
  }
}

class FakeCategoryLookup implements ShopCategoryLookup {
  constructor(private readonly ids: Set<number>) {}
  async getCategory(id: number): Promise<{ id: number } | null> {
    return this.ids.has(id) ? { id } : null;
  }
}

function service(categoryIds: number[] = [1]): {
  db: FakeShopProductsDb;
  svc: ShopProductsService;
} {
  const db = new FakeShopProductsDb();
  return { db, svc: new ShopProductsService(db, new FakeCategoryLookup(new Set(categoryIds))) };
}

const BASE_CREATE: ShopProductCreateInput = {
  sku: 'sword-01',
  name: 'Iron Sword',
  slug: 'iron-sword',
  description: '',
  categoryId: 0,
  priceGoldCopper: '1000',
  priceClaudium: '',
  priceUsdCents: '',
  railSol: false,
  railUsdc: false,
  railWoc: false,
  status: 'draft',
  featured: false,
  grantKind: 'none',
  grantItemId: '',
  grantQuantity: '',
};

describe('ShopProductsService', () => {
  let ctx: ReturnType<typeof service>;

  beforeEach(() => {
    ctx = service();
  });

  it('creates a product priced in gold only', async () => {
    const result = await ctx.svc.createProduct(BASE_CREATE);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.product.priceGoldCopper).toBe(1000);
      expect(result.product.priceClaudium).toBeNull();
      expect(result.product.priceUsdCents).toBeNull();
      expect(result.product.categoryId).toBeNull();
    }
  });

  it('rejects a product with no price set at all', async () => {
    const result = await ctx.svc.createProduct({
      ...BASE_CREATE,
      priceGoldCopper: '',
    });
    expect(result).toEqual({ ok: false, error: 'no_price' });
  });

  it('rejects a malformed price string', async () => {
    const result = await ctx.svc.createProduct({ ...BASE_CREATE, priceGoldCopper: '-5' });
    expect(result).toEqual({ ok: false, error: 'invalid_price' });
  });

  it('rejects a crypto rail with no USD price to quote it from', async () => {
    const result = await ctx.svc.createProduct({ ...BASE_CREATE, railSol: true });
    expect(result).toEqual({ ok: false, error: 'rails_need_usd_price' });
  });

  it('accepts a crypto rail once a USD price is set', async () => {
    const result = await ctx.svc.createProduct({
      ...BASE_CREATE,
      railSol: true,
      priceUsdCents: '999',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.product.railSol).toBe(true);
      expect(result.product.priceUsdCents).toBe(999);
    }
  });

  it('rejects an unknown category', async () => {
    const result = await ctx.svc.createProduct({ ...BASE_CREATE, categoryId: 42 });
    expect(result).toEqual({ ok: false, error: 'category_not_found' });
  });

  it('assigns a known category', async () => {
    const result = await ctx.svc.createProduct({ ...BASE_CREATE, categoryId: 1 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.product.categoryId).toBe(1);
  });

  it('rejects an invalid slug format', async () => {
    const result = await ctx.svc.createProduct({ ...BASE_CREATE, slug: 'Not Valid' });
    expect(result).toEqual({ ok: false, error: 'invalid_slug' });
  });

  it('updates a product, clearing one price while keeping another', async () => {
    const created = await ctx.svc.createProduct({
      ...BASE_CREATE,
      priceUsdCents: '500',
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const cleared = await ctx.svc.updateProduct(created.product.id, { priceUsdCents: '' });
    expect(cleared.ok).toBe(true);
    if (cleared.ok) {
      expect(cleared.product.priceUsdCents).toBeNull();
      expect(cleared.product.priceGoldCopper).toBe(1000); // untouched
    }
  });

  it('rejects clearing the last remaining price via update', async () => {
    const created = await ctx.svc.createProduct(BASE_CREATE);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const result = await ctx.svc.updateProduct(created.product.id, { priceGoldCopper: '' });
    expect(result).toEqual({ ok: false, error: 'no_price' });
  });

  it('rejects clearing the USD price while a crypto rail is still enabled', async () => {
    const created = await ctx.svc.createProduct({
      ...BASE_CREATE,
      railWoc: true,
      priceUsdCents: '250',
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const result = await ctx.svc.updateProduct(created.product.id, { priceUsdCents: '' });
    expect(result).toEqual({ ok: false, error: 'rails_need_usd_price' });
  });

  it('returns not_found when updating a missing product', async () => {
    const result = await ctx.svc.updateProduct(999, { name: 'Ghost' });
    expect(result).toEqual({ ok: false, error: 'not_found' });
  });

  it('lists products filtered by category and status', async () => {
    await ctx.svc.createProduct({ ...BASE_CREATE, sku: 'a', slug: 'a', categoryId: 1 });
    await ctx.svc.createProduct({
      ...BASE_CREATE,
      sku: 'b',
      slug: 'b',
      categoryId: 0,
      status: 'active',
    });
    const { rows, total } = await ctx.svc.listProducts({
      page: 1,
      limit: 20,
      q: '',
      categoryId: 0,
      sort: 'name',
      dir: 'asc',
    });
    expect(total).toBe(1);
    expect(rows[0].sku).toBe('b');
  });

  it('deletes a product', async () => {
    const created = await ctx.svc.createProduct(BASE_CREATE);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(await ctx.svc.deleteProduct(created.product.id)).toBe(true);
    expect(await ctx.svc.getProduct(created.product.id)).toBeNull();
  });
});
