import { beforeEach, describe, expect, it } from 'vitest';
import type {
  ShopCategoriesDb,
  ShopCategoryListParams,
  ShopCategoryRecord,
  ShopCategoryWriteRow,
} from '../server/shop_categories';
import { ShopCategoriesService } from '../server/shop_categories';

// In-memory fake mirroring PgShopCategoriesDb's contract (see server/CLAUDE.md:
// "Endpoint tests: FakeDb, not a pg-mock"). No Postgres, no pool.
class FakeShopCategoriesDb implements ShopCategoriesDb {
  private rows: ShopCategoryRecord[] = [];
  private nextId = 1;

  async insertCategory(row: ShopCategoryWriteRow): Promise<ShopCategoryRecord> {
    if (this.rows.some((r) => r.slug === row.slug)) {
      throw Object.assign(new Error('duplicate key value violates unique constraint'), {
        code: '23505',
      });
    }
    const record: ShopCategoryRecord = {
      id: this.nextId++,
      name: row.name,
      slug: row.slug,
      description: row.description,
      parentId: row.parentId,
      sortOrder: row.sortOrder,
      status: row.status,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    };
    this.rows.push(record);
    return record;
  }

  async getCategory(id: number): Promise<ShopCategoryRecord | null> {
    return this.rows.find((r) => r.id === id) ?? null;
  }

  async getCategoryBySlug(slug: string): Promise<ShopCategoryRecord | null> {
    return this.rows.find((r) => r.slug === slug) ?? null;
  }

  async listCategories(
    params: ShopCategoryListParams,
  ): Promise<{ rows: ShopCategoryRecord[]; total: number }> {
    let filtered = this.rows.slice();
    if (params.q) {
      const q = params.q.toLowerCase();
      filtered = filtered.filter(
        (r) => r.name.toLowerCase().includes(q) || r.slug.toLowerCase().includes(q),
      );
    }
    if (params.parentId !== undefined) {
      filtered = filtered.filter((r) =>
        params.parentId === 0 ? r.parentId === null : r.parentId === params.parentId,
      );
    }
    if (params.status !== undefined) {
      filtered = filtered.filter((r) => r.status === params.status);
    }
    const dir = params.dir === 'asc' ? 1 : -1;
    filtered.sort((a, b) => {
      if (params.sort === 'name') return a.name.localeCompare(b.name) * dir;
      if (params.sort === 'sortOrder') return (a.sortOrder - b.sortOrder) * dir;
      return a.createdAt.localeCompare(b.createdAt) * dir;
    });
    const total = filtered.length;
    const offset = (params.page - 1) * params.limit;
    return { rows: filtered.slice(offset, offset + params.limit), total };
  }

  async updateCategory(
    id: number,
    patch: Partial<ShopCategoryWriteRow>,
  ): Promise<ShopCategoryRecord | null> {
    const row = this.rows.find((r) => r.id === id);
    if (!row) return null;
    if (patch.slug !== undefined && this.rows.some((r) => r.id !== id && r.slug === patch.slug)) {
      throw Object.assign(new Error('duplicate key value violates unique constraint'), {
        code: '23505',
      });
    }
    Object.assign(row, patch);
    row.updatedAt = new Date(1).toISOString();
    return row;
  }

  async deleteCategory(id: number): Promise<boolean> {
    const before = this.rows.length;
    this.rows = this.rows.filter((r) => r.id !== id);
    return this.rows.length < before;
  }
}

function service(): { db: FakeShopCategoriesDb; svc: ShopCategoriesService } {
  const db = new FakeShopCategoriesDb();
  return { db, svc: new ShopCategoriesService(db) };
}

const BASE_CREATE = {
  name: 'Weapons',
  slug: 'weapons',
  description: '',
  parentId: 0,
  sortOrder: 0,
  status: 'active' as const,
};

describe('ShopCategoriesService', () => {
  let ctx: ReturnType<typeof service>;

  beforeEach(() => {
    ctx = service();
  });

  it('creates a root category', async () => {
    const result = await ctx.svc.createCategory(BASE_CREATE);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.category.name).toBe('Weapons');
      expect(result.category.parentId).toBeNull();
      expect(result.category.status).toBe('active');
    }
  });

  it('rejects an invalid slug format', async () => {
    const result = await ctx.svc.createCategory({ ...BASE_CREATE, slug: 'Not Valid!' });
    expect(result).toEqual({ ok: false, error: 'invalid_slug' });
  });

  it('rejects a parent id that does not exist', async () => {
    const result = await ctx.svc.createCategory({ ...BASE_CREATE, parentId: 999 });
    expect(result).toEqual({ ok: false, error: 'parent_not_found' });
  });

  it('creates a child category under an existing parent', async () => {
    const parent = await ctx.svc.createCategory(BASE_CREATE);
    expect(parent.ok).toBe(true);
    if (!parent.ok) return;
    const child = await ctx.svc.createCategory({
      ...BASE_CREATE,
      slug: 'swords',
      name: 'Swords',
      parentId: parent.category.id,
    });
    expect(child.ok).toBe(true);
    if (child.ok) expect(child.category.parentId).toBe(parent.category.id);
  });

  it('lists categories with pagination, search, and sort', async () => {
    await ctx.svc.createCategory({ ...BASE_CREATE, slug: 'alpha', name: 'Alpha' });
    await ctx.svc.createCategory({ ...BASE_CREATE, slug: 'beta', name: 'Beta' });
    const { rows, total } = await ctx.svc.listCategories({
      page: 1,
      limit: 1,
      q: '',
      sort: 'name',
      dir: 'asc',
    });
    expect(total).toBe(2);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Alpha');
  });

  it('filters the list by search query', async () => {
    await ctx.svc.createCategory({ ...BASE_CREATE, slug: 'alpha', name: 'Alpha' });
    await ctx.svc.createCategory({ ...BASE_CREATE, slug: 'beta', name: 'Beta' });
    const { rows, total } = await ctx.svc.listCategories({
      page: 1,
      limit: 20,
      q: 'bet',
      sort: 'name',
      dir: 'asc',
    });
    expect(total).toBe(1);
    expect(rows[0].name).toBe('Beta');
  });

  it('updates a category and rejects self-parenting', async () => {
    const created = await ctx.svc.createCategory(BASE_CREATE);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const id = created.category.id;

    const renamed = await ctx.svc.updateCategory(id, { name: 'Melee Weapons' });
    expect(renamed.ok).toBe(true);
    if (renamed.ok) expect(renamed.category.name).toBe('Melee Weapons');

    const selfParent = await ctx.svc.updateCategory(id, { parentId: id });
    expect(selfParent).toEqual({ ok: false, error: 'self_parent' });
  });

  it('rejects a parent reassignment that would create a cycle', async () => {
    const a = await ctx.svc.createCategory({ ...BASE_CREATE, slug: 'a', name: 'A' });
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    const b = await ctx.svc.createCategory({
      ...BASE_CREATE,
      slug: 'b',
      name: 'B',
      parentId: a.category.id,
    });
    expect(b.ok).toBe(true);
    if (!b.ok) return;
    // A is currently root; making A's parent B would close A -> B -> A.
    const cycle = await ctx.svc.updateCategory(a.category.id, { parentId: b.category.id });
    expect(cycle).toEqual({ ok: false, error: 'parent_cycle' });
  });

  it('returns not_found when updating a missing category', async () => {
    const result = await ctx.svc.updateCategory(999, { name: 'Ghost' });
    expect(result).toEqual({ ok: false, error: 'not_found' });
  });

  it('deletes a category', async () => {
    const created = await ctx.svc.createCategory(BASE_CREATE);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(await ctx.svc.deleteCategory(created.category.id)).toBe(true);
    expect(await ctx.svc.getCategory(created.category.id)).toBeNull();
    expect(await ctx.svc.deleteCategory(created.category.id)).toBe(false);
  });
});
