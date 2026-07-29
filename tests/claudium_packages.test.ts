import { beforeEach, describe, expect, it } from 'vitest';
import type {
  ClaudiumPackageCreateInput,
  ClaudiumPackageListParams,
  ClaudiumPackageRecord,
  ClaudiumPackagesDb,
  ClaudiumPackageWriteRow,
} from '../server/claudium_packages';
import { ClaudiumPackagesService } from '../server/claudium_packages';

// In-memory fake mirroring PgClaudiumPackagesDb's contract (server/CLAUDE.md:
// "Endpoint tests: FakeDb, not a pg-mock").
class FakeClaudiumPackagesDb implements ClaudiumPackagesDb {
  private rows: ClaudiumPackageRecord[] = [];
  private nextId = 1;

  async insertPackage(row: ClaudiumPackageWriteRow): Promise<ClaudiumPackageRecord> {
    const record: ClaudiumPackageRecord = {
      id: this.nextId++,
      ...row,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    };
    this.rows.push(record);
    return record;
  }

  async getPackage(id: number): Promise<ClaudiumPackageRecord | null> {
    return this.rows.find((r) => r.id === id) ?? null;
  }

  async listPackages(
    params: ClaudiumPackageListParams,
  ): Promise<{ rows: ClaudiumPackageRecord[]; total: number }> {
    let filtered = this.rows.slice();
    if (params.q) {
      const q = params.q.toLowerCase();
      filtered = filtered.filter((r) => r.name.toLowerCase().includes(q));
    }
    if (params.enabled !== undefined) {
      filtered = filtered.filter((r) => r.enabled === params.enabled);
    }
    if (params.featured !== undefined) {
      filtered = filtered.filter((r) => r.featured === params.featured);
    }
    const dir = params.dir === 'asc' ? 1 : -1;
    filtered.sort((a, b) => {
      if (params.sort === 'name') return a.name.localeCompare(b.name) * dir;
      if (params.sort === 'createdAt') return a.createdAt.localeCompare(b.createdAt) * dir;
      if (params.sort === 'updatedAt') return a.updatedAt.localeCompare(b.updatedAt) * dir;
      return (a.displayOrder - b.displayOrder) * dir;
    });
    const total = filtered.length;
    const offset = (params.page - 1) * params.limit;
    return { rows: filtered.slice(offset, offset + params.limit), total };
  }

  async updatePackage(
    id: number,
    patch: Partial<ClaudiumPackageWriteRow>,
  ): Promise<ClaudiumPackageRecord | null> {
    const row = this.rows.find((r) => r.id === id);
    if (!row) return null;
    Object.assign(row, patch);
    row.updatedAt = new Date(1).toISOString();
    return row;
  }

  async deletePackage(id: number): Promise<boolean> {
    const before = this.rows.length;
    this.rows = this.rows.filter((r) => r.id !== id);
    return this.rows.length < before;
  }
}

function service(): { db: FakeClaudiumPackagesDb; svc: ClaudiumPackagesService } {
  const db = new FakeClaudiumPackagesDb();
  return { db, svc: new ClaudiumPackagesService(db) };
}

const BASE_CREATE: ClaudiumPackageCreateInput = {
  name: 'Starter Pack',
  claudiumAmount: 500,
  bonusAmount: 0,
  price: 499,
  currency: 'USD',
  stripePriceId: '',
  imageUrl: '',
  discountPercent: 0,
  featured: false,
  enabled: true,
  displayOrder: 0,
};

describe('ClaudiumPackagesService', () => {
  let ctx: ReturnType<typeof service>;

  beforeEach(() => {
    ctx = service();
  });

  it('creates a package with the given fields', async () => {
    const result = await ctx.svc.createPackage(BASE_CREATE);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.pkg).toMatchObject({
      name: 'Starter Pack',
      claudiumAmount: 500,
      bonusAmount: 0,
      price: 499,
      currency: 'USD',
      stripePriceId: null,
      enabled: true,
      displayOrder: 0,
    });
  });

  it('treats an empty stripePriceId as null (clears it)', async () => {
    const result = await ctx.svc.createPackage({ ...BASE_CREATE, stripePriceId: '  ' });
    if (!result.ok) throw new Error('expected ok');
    expect(result.pkg.stripePriceId).toBeNull();
  });

  it('stores the merchandising fields: imageUrl, discountPercent, featured', async () => {
    const result = await ctx.svc.createPackage({
      ...BASE_CREATE,
      imageUrl: 'https://example.com/pack.png',
      discountPercent: 25,
      featured: true,
    });
    if (!result.ok) throw new Error('expected ok');
    expect(result.pkg.imageUrl).toBe('https://example.com/pack.png');
    expect(result.pkg.discountPercent).toBe(25);
    expect(result.pkg.featured).toBe(true);
  });

  it('treats an empty imageUrl as null (clears it)', async () => {
    const result = await ctx.svc.createPackage({ ...BASE_CREATE, imageUrl: '   ' });
    if (!result.ok) throw new Error('expected ok');
    expect(result.pkg.imageUrl).toBeNull();
  });

  it('updates imageUrl/discountPercent/featured independently via a partial patch', async () => {
    const created = await ctx.svc.createPackage(BASE_CREATE);
    if (!created.ok) throw new Error('expected ok');
    const updated = await ctx.svc.updatePackage(created.pkg.id, {
      discountPercent: 10,
      featured: true,
    });
    if (!updated.ok) throw new Error('expected ok');
    expect(updated.pkg.discountPercent).toBe(10);
    expect(updated.pkg.featured).toBe(true);
    // Untouched fields survive the partial patch.
    expect(updated.pkg.name).toBe('Starter Pack');
    expect(updated.pkg.imageUrl).toBeNull();
  });

  it('filters by featured', async () => {
    await ctx.svc.createPackage({ ...BASE_CREATE, name: 'Featured Pack', featured: true });
    await ctx.svc.createPackage({ ...BASE_CREATE, name: 'Plain Pack', featured: false });
    const { rows } = await ctx.svc.listPackages({
      page: 1,
      limit: 20,
      q: '',
      featured: true,
      sort: 'displayOrder',
      dir: 'asc',
    });
    expect(rows.map((r) => r.name)).toEqual(['Featured Pack']);
  });

  it('trims and stores a non-empty stripePriceId', async () => {
    const result = await ctx.svc.createPackage({ ...BASE_CREATE, stripePriceId: ' price_123 ' });
    if (!result.ok) throw new Error('expected ok');
    expect(result.pkg.stripePriceId).toBe('price_123');
  });

  it('lists created packages sorted by displayOrder', async () => {
    await ctx.svc.createPackage({ ...BASE_CREATE, name: 'Gold Pack', displayOrder: 2 });
    await ctx.svc.createPackage({ ...BASE_CREATE, name: 'Starter Pack', displayOrder: 0 });
    await ctx.svc.createPackage({ ...BASE_CREATE, name: 'Bronze Pack', displayOrder: 1 });
    const { rows, total } = await ctx.svc.listPackages({
      page: 1,
      limit: 20,
      q: '',
      sort: 'displayOrder',
      dir: 'asc',
    });
    expect(total).toBe(3);
    expect(rows.map((r) => r.name)).toEqual(['Starter Pack', 'Bronze Pack', 'Gold Pack']);
  });

  it('filters by enabled', async () => {
    await ctx.svc.createPackage({ ...BASE_CREATE, name: 'Active Pack', enabled: true });
    await ctx.svc.createPackage({ ...BASE_CREATE, name: 'Disabled Pack', enabled: false });
    const { rows } = await ctx.svc.listPackages({
      page: 1,
      limit: 20,
      q: '',
      enabled: false,
      sort: 'displayOrder',
      dir: 'asc',
    });
    expect(rows.map((r) => r.name)).toEqual(['Disabled Pack']);
  });

  it('updates only the fields provided, leaving the rest unchanged', async () => {
    const created = await ctx.svc.createPackage(BASE_CREATE);
    if (!created.ok) throw new Error('expected ok');
    const updated = await ctx.svc.updatePackage(created.pkg.id, { claudiumAmount: 1000 });
    expect(updated.ok).toBe(true);
    if (!updated.ok) throw new Error('expected ok');
    expect(updated.pkg.claudiumAmount).toBe(1000);
    expect(updated.pkg.name).toBe('Starter Pack');
    expect(updated.pkg.price).toBe(499);
  });

  it('returns not_found when updating a missing package', async () => {
    const result = await ctx.svc.updatePackage(999, { claudiumAmount: 1000 });
    expect(result).toEqual({ ok: false, error: 'not_found' });
  });

  it('deletes a package', async () => {
    const created = await ctx.svc.createPackage(BASE_CREATE);
    if (!created.ok) throw new Error('expected ok');
    expect(await ctx.svc.deletePackage(created.pkg.id)).toBe(true);
    expect(await ctx.svc.getPackage(created.pkg.id)).toBeNull();
  });

  it('returns false deleting a missing package', async () => {
    expect(await ctx.svc.deletePackage(999)).toBe(false);
  });
});
