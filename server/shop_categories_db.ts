// Postgres-backed ShopCategoriesDb plus the shop_categories schema. The schema
// is appended to the main ensureSchema() run in db.ts (idempotent CREATE/ALTER
// only, applied at every boot under the advisory lock). All SQL for the shop
// category tree lives here; the rules live in shop_categories.ts.

import type { Pool } from 'pg';
import type {
  ShopCategoriesDb,
  ShopCategoryListParams,
  ShopCategoryRecord,
  ShopCategoryWriteRow,
} from './shop_categories';

export const SHOP_CATEGORIES_SCHEMA = `
CREATE TABLE IF NOT EXISTS shop_categories (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  parent_id INT REFERENCES shop_categories(id) ON DELETE SET NULL,
  sort_order INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Postgres does not auto-index the referencing side of an FK: without this,
-- every parent-category delete sequentially scans shop_categories to null out
-- children (see server/maps_db.ts for the same lesson on maps.parent_map_id).
CREATE INDEX IF NOT EXISTS shop_categories_parent ON shop_categories(parent_id);
-- Serves the admin list (status filter + sort-order paging, the default sort).
CREATE INDEX IF NOT EXISTS shop_categories_status_sort ON shop_categories(status, sort_order);
`;

const CATEGORY_COLS =
  'id, name, slug, description, parent_id, sort_order, status, created_at, updated_at';

function isoString(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value ?? '');
}

interface CategoryDbRow {
  id: number;
  name: string;
  slug: string;
  description: string;
  parent_id: number | null;
  sort_order: number;
  status: string;
  created_at: Date | string;
  updated_at: Date | string;
}

function toRecord(row: CategoryDbRow): ShopCategoryRecord {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    parentId: row.parent_id ?? null,
    sortOrder: row.sort_order,
    status: row.status as ShopCategoryRecord['status'],
    createdAt: isoString(row.created_at),
    updatedAt: isoString(row.updated_at),
  };
}

const SORT_COLUMN: Record<ShopCategoryListParams['sort'], string> = {
  name: 'name',
  sortOrder: 'sort_order',
  createdAt: 'created_at',
};

export class PgShopCategoriesDb implements ShopCategoriesDb {
  constructor(private readonly pool: Pool) {}

  async insertCategory(row: ShopCategoryWriteRow): Promise<ShopCategoryRecord> {
    const res = await this.pool.query(
      `INSERT INTO shop_categories (name, slug, description, parent_id, sort_order, status)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING ${CATEGORY_COLS}`,
      [row.name, row.slug, row.description, row.parentId, row.sortOrder, row.status],
    );
    return toRecord(res.rows[0]);
  }

  async getCategory(id: number): Promise<ShopCategoryRecord | null> {
    const res = await this.pool.query(
      `SELECT ${CATEGORY_COLS} FROM shop_categories WHERE id = $1`,
      [id],
    );
    return res.rows[0] ? toRecord(res.rows[0]) : null;
  }

  async getCategoryBySlug(slug: string): Promise<ShopCategoryRecord | null> {
    const res = await this.pool.query(
      `SELECT ${CATEGORY_COLS} FROM shop_categories WHERE slug = $1`,
      [slug],
    );
    return res.rows[0] ? toRecord(res.rows[0]) : null;
  }

  async listCategories(
    params: ShopCategoryListParams,
  ): Promise<{ rows: ShopCategoryRecord[]; total: number }> {
    const conditions: string[] = [];
    const values: unknown[] = [];
    if (params.q) {
      values.push(`%${params.q}%`);
      conditions.push(`(name ILIKE $${values.length} OR slug ILIKE $${values.length})`);
    }
    if (params.parentId !== undefined) {
      if (params.parentId === 0) {
        conditions.push('parent_id IS NULL');
      } else {
        values.push(params.parentId);
        conditions.push(`parent_id = $${values.length}`);
      }
    }
    if (params.status !== undefined) {
      values.push(params.status);
      conditions.push(`status = $${values.length}`);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const orderCol = SORT_COLUMN[params.sort];
    const orderDir = params.dir === 'asc' ? 'ASC' : 'DESC';
    const limitIdx = values.length + 1;
    const offsetIdx = values.length + 2;
    const rowsRes = await this.pool.query(
      `SELECT ${CATEGORY_COLS} FROM shop_categories ${where}
        ORDER BY ${orderCol} ${orderDir}, id ${orderDir}
        LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      [...values, params.limit, (params.page - 1) * params.limit],
    );
    const totalRes = await this.pool.query(
      `SELECT count(*)::int AS n FROM shop_categories ${where}`,
      values,
    );
    return {
      rows: rowsRes.rows.map(toRecord),
      total: Number(totalRes.rows[0]?.n ?? 0),
    };
  }

  async updateCategory(
    id: number,
    patch: Partial<ShopCategoryWriteRow>,
  ): Promise<ShopCategoryRecord | null> {
    const sets: string[] = [];
    const values: unknown[] = [];
    if (patch.name !== undefined) {
      values.push(patch.name);
      sets.push(`name = $${values.length}`);
    }
    if (patch.slug !== undefined) {
      values.push(patch.slug);
      sets.push(`slug = $${values.length}`);
    }
    if (patch.description !== undefined) {
      values.push(patch.description);
      sets.push(`description = $${values.length}`);
    }
    if (patch.parentId !== undefined) {
      values.push(patch.parentId);
      sets.push(`parent_id = $${values.length}`);
    }
    if (patch.sortOrder !== undefined) {
      values.push(patch.sortOrder);
      sets.push(`sort_order = $${values.length}`);
    }
    if (patch.status !== undefined) {
      values.push(patch.status);
      sets.push(`status = $${values.length}`);
    }
    if (sets.length === 0) return this.getCategory(id);
    sets.push('updated_at = now()');
    values.push(id);
    const res = await this.pool.query(
      `UPDATE shop_categories SET ${sets.join(', ')} WHERE id = $${values.length}
       RETURNING ${CATEGORY_COLS}`,
      values,
    );
    return res.rows[0] ? toRecord(res.rows[0]) : null;
  }

  async deleteCategory(id: number): Promise<boolean> {
    const res = await this.pool.query('DELETE FROM shop_categories WHERE id = $1 RETURNING id', [
      id,
    ]);
    return (res.rowCount ?? 0) > 0;
  }
}
