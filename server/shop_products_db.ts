// Postgres-backed ShopProductsDb plus the shop_products schema. The schema is
// appended to the main ensureSchema() run in db.ts (idempotent CREATE/ALTER
// only, applied at every boot under the advisory lock, after shop_categories
// since category_id references it). All SQL for the product catalog lives
// here; the rules live in shop_products.ts.

import type { Pool } from 'pg';
import type {
  ShopProductListParams,
  ShopProductRecord,
  ShopProductsDb,
  ShopProductWriteRow,
} from './shop_products';

export const SHOP_PRODUCTS_SCHEMA = `
CREATE TABLE IF NOT EXISTS shop_products (
  id SERIAL PRIMARY KEY,
  sku TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category_id INT REFERENCES shop_categories(id) ON DELETE SET NULL,
  price_gold_copper BIGINT,
  price_claudium INT,
  price_usd_cents INT,
  rail_sol BOOLEAN NOT NULL DEFAULT false,
  rail_usdc BOOLEAN NOT NULL DEFAULT false,
  rail_woc BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT shop_products_price_present CHECK (
    price_gold_copper IS NOT NULL OR price_claudium IS NOT NULL OR price_usd_cents IS NOT NULL
  ),
  CONSTRAINT shop_products_price_gold_nonneg CHECK (price_gold_copper IS NULL OR price_gold_copper >= 0),
  CONSTRAINT shop_products_price_claudium_nonneg CHECK (price_claudium IS NULL OR price_claudium >= 0),
  CONSTRAINT shop_products_price_usd_nonneg CHECK (price_usd_cents IS NULL OR price_usd_cents >= 0),
  -- A crypto rail is only meaningful with a canonical USD price to quote it
  -- from (docs/claudium-store.md: SOL/USDC/WOC amounts are quoted from the USD
  -- value). Defense in depth alongside the identical service-layer check.
  CONSTRAINT shop_products_rails_need_usd CHECK (
    NOT (rail_sol OR rail_usdc OR rail_woc) OR price_usd_cents IS NOT NULL
  )
);
-- Storefront (Phase 4): a curated merchandising flag, added after the table
-- first shipped (Phase 1), so it grows via ALTER rather than editing the
-- CREATE TABLE above (server/CLAUDE.md: shipped DDL is only ever added to).
ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS featured BOOLEAN NOT NULL DEFAULT false;
-- In-game Shop (Phase 5): what a purchase actually delivers. 'none' (the
-- default) covers every product that predates this column; 'weapon_skin'
-- reuses the account-cosmetics grant path (grantAccountWeaponSkins), 'item'
-- delivers grantQuantity of grantItemId via system mail to the buyer's live
-- character. Kind/id/quantity coherence is enforced service-side
-- (shop_products.ts), not by a DB CHECK, matching the existing price-presence
-- rule's split.
ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS grant_kind TEXT NOT NULL DEFAULT 'none';
ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS grant_item_id TEXT;
ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS grant_quantity INT NOT NULL DEFAULT 1;
-- Phase 7 (the in-repo Claudium economy): an admin-set icon (a URL or a
-- served asset path; NULL falls back to the client's existing grant-based
-- icon resolution) and an explicit admin-controlled sort key, independent of
-- name/createdAt/updatedAt.
ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS icon TEXT;
ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS display_order INT NOT NULL DEFAULT 0;
-- Premium Shop (Phase 2): merchandising rarity/badges plus the fields the
-- Admin Panel's Products page and the rarity-gated announcement feature read.
-- 'common' is the correct default for every product predating this column: it
-- is the bottom tier, so a product nobody has curated yet renders with no
-- special visual treatment. badges is a closed vocabulary (server/
-- shop_products.ts SHOP_BADGES), validated at the route layer, not by a CHECK
-- (matching how grant_kind's closed vocabulary is enforced service-side).
ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS rarity TEXT NOT NULL DEFAULT 'common';
ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS badges TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS is_event BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS is_limited BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS discount_percent SMALLINT;
ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS banner_image TEXT;
ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS preview_image TEXT;
-- Per-product override of the global announcement message template (server/
-- shop_announcement.ts); NULL falls back to the admin-configured global
-- default.
ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS announcement_template TEXT;
ALTER TABLE shop_products DROP CONSTRAINT IF EXISTS shop_products_discount_percent_range;
ALTER TABLE shop_products ADD CONSTRAINT shop_products_discount_percent_range CHECK (
  discount_percent IS NULL OR (discount_percent >= 1 AND discount_percent <= 99)
);
-- Postgres does not auto-index the referencing side of an FK (see
-- server/maps_db.ts / server/shop_categories_db.ts for the same lesson).
CREATE INDEX IF NOT EXISTS shop_products_category ON shop_products(category_id);
-- Serves the admin list (status filter + newest-first paging, the default sort).
CREATE INDEX IF NOT EXISTS shop_products_status_updated ON shop_products(status, updated_at DESC);
-- Serves the storefront's "Featured products" query (Phase 4): a small partial
-- index, since only a handful of products are ever featured at once.
CREATE INDEX IF NOT EXISTS shop_products_featured ON shop_products(status, created_at DESC)
  WHERE featured = true;
-- Serves a "browse by rarity" filter (Phase 2 Premium Shop): rare+ tiers are a
-- small minority of the catalog, same partial-index shape as the featured one
-- above.
CREATE INDEX IF NOT EXISTS shop_products_rarity ON shop_products(status, rarity, created_at DESC)
  WHERE rarity <> 'common';
`;

const PRODUCT_COLS = `id, sku, name, slug, description, category_id,
  price_gold_copper, price_claudium, price_usd_cents,
  rail_sol, rail_usdc, rail_woc, status, featured,
  grant_kind, grant_item_id, grant_quantity, icon, display_order,
  rarity, badges, is_event, is_limited, discount_percent, banner_image,
  preview_image, announcement_template, created_at, updated_at`;

function isoString(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value ?? '');
}

interface ProductDbRow {
  id: number;
  sku: string;
  name: string;
  slug: string;
  description: string;
  category_id: number | null;
  price_gold_copper: string | number | null;
  price_claudium: number | null;
  price_usd_cents: number | null;
  rail_sol: boolean;
  rail_usdc: boolean;
  rail_woc: boolean;
  status: string;
  featured: boolean;
  grant_kind: string;
  grant_item_id: string | null;
  grant_quantity: number;
  icon: string | null;
  display_order: number;
  rarity: string;
  badges: string[];
  is_event: boolean;
  is_limited: boolean;
  discount_percent: number | null;
  banner_image: string | null;
  preview_image: string | null;
  announcement_template: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

// pg returns BIGINT columns as strings to avoid silent precision loss; this
// column only ever carries a value this service wrote as a JS safe integer, so
// converting back to a number is safe (see shop_products.ts's parsePriceField).
function toGoldCopper(value: string | number | null): number | null {
  if (value === null) return null;
  return typeof value === 'string' ? Number(value) : value;
}

function toRecord(row: ProductDbRow): ShopProductRecord {
  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    slug: row.slug,
    description: row.description,
    categoryId: row.category_id ?? null,
    priceGoldCopper: toGoldCopper(row.price_gold_copper),
    priceClaudium: row.price_claudium ?? null,
    priceUsdCents: row.price_usd_cents ?? null,
    railSol: row.rail_sol,
    railUsdc: row.rail_usdc,
    railWoc: row.rail_woc,
    status: row.status as ShopProductRecord['status'],
    featured: row.featured,
    grantKind: row.grant_kind as ShopProductRecord['grantKind'],
    grantItemId: row.grant_item_id ?? null,
    grantQuantity: row.grant_quantity,
    icon: row.icon ?? null,
    displayOrder: row.display_order,
    rarity: row.rarity as ShopProductRecord['rarity'],
    badges: (row.badges ?? []) as ShopProductRecord['badges'],
    isEvent: row.is_event,
    isLimited: row.is_limited,
    discountPercent: row.discount_percent ?? null,
    bannerImage: row.banner_image ?? null,
    previewImage: row.preview_image ?? null,
    announcementTemplate: row.announcement_template ?? null,
    createdAt: isoString(row.created_at),
    updatedAt: isoString(row.updated_at),
  };
}

const SORT_COLUMN: Record<ShopProductListParams['sort'], string> = {
  name: 'name',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  displayOrder: 'display_order',
};

export class PgShopProductsDb implements ShopProductsDb {
  constructor(private readonly pool: Pool) {}

  async insertProduct(row: ShopProductWriteRow): Promise<ShopProductRecord> {
    const res = await this.pool.query(
      `INSERT INTO shop_products
         (sku, name, slug, description, category_id,
          price_gold_copper, price_claudium, price_usd_cents,
          rail_sol, rail_usdc, rail_woc, status, featured,
          grant_kind, grant_item_id, grant_quantity, icon, display_order,
          rarity, badges, is_event, is_limited, discount_percent, banner_image,
          preview_image, announcement_template)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18,
               $19, $20, $21, $22, $23, $24, $25, $26)
       RETURNING ${PRODUCT_COLS}`,
      [
        row.sku,
        row.name,
        row.slug,
        row.description,
        row.categoryId,
        row.priceGoldCopper,
        row.priceClaudium,
        row.priceUsdCents,
        row.railSol,
        row.railUsdc,
        row.railWoc,
        row.status,
        row.featured,
        row.grantKind,
        row.grantItemId,
        row.grantQuantity,
        row.icon,
        row.displayOrder,
        row.rarity,
        row.badges,
        row.isEvent,
        row.isLimited,
        row.discountPercent,
        row.bannerImage,
        row.previewImage,
        row.announcementTemplate,
      ],
    );
    return toRecord(res.rows[0]);
  }

  async getProduct(id: number): Promise<ShopProductRecord | null> {
    const res = await this.pool.query(`SELECT ${PRODUCT_COLS} FROM shop_products WHERE id = $1`, [
      id,
    ]);
    return res.rows[0] ? toRecord(res.rows[0]) : null;
  }

  async getProductBySlug(slug: string): Promise<ShopProductRecord | null> {
    const res = await this.pool.query(`SELECT ${PRODUCT_COLS} FROM shop_products WHERE slug = $1`, [
      slug,
    ]);
    return res.rows[0] ? toRecord(res.rows[0]) : null;
  }

  async listProducts(
    params: ShopProductListParams,
  ): Promise<{ rows: ShopProductRecord[]; total: number }> {
    const conditions: string[] = [];
    const values: unknown[] = [];
    if (params.q) {
      values.push(`%${params.q}%`);
      conditions.push(`(name ILIKE $${values.length} OR sku ILIKE $${values.length})`);
    }
    if (params.categoryId !== undefined) {
      if (params.categoryId === 0) {
        conditions.push('category_id IS NULL');
      } else {
        values.push(params.categoryId);
        conditions.push(`category_id = $${values.length}`);
      }
    }
    if (params.status !== undefined) {
      values.push(params.status);
      conditions.push(`status = $${values.length}`);
    }
    if (params.featured !== undefined) {
      values.push(params.featured);
      conditions.push(`featured = $${values.length}`);
    }
    if (params.rarity !== undefined) {
      values.push(params.rarity);
      conditions.push(`rarity = $${values.length}`);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const orderCol = SORT_COLUMN[params.sort];
    const orderDir = params.dir === 'asc' ? 'ASC' : 'DESC';
    const limitIdx = values.length + 1;
    const offsetIdx = values.length + 2;
    const rowsRes = await this.pool.query(
      `SELECT ${PRODUCT_COLS} FROM shop_products ${where}
        ORDER BY ${orderCol} ${orderDir}, id ${orderDir}
        LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      [...values, params.limit, (params.page - 1) * params.limit],
    );
    const totalRes = await this.pool.query(
      `SELECT count(*)::int AS n FROM shop_products ${where}`,
      values,
    );
    return {
      rows: rowsRes.rows.map(toRecord),
      total: Number(totalRes.rows[0]?.n ?? 0),
    };
  }

  async updateProduct(
    id: number,
    patch: Partial<ShopProductWriteRow>,
  ): Promise<ShopProductRecord | null> {
    const sets: string[] = [];
    const values: unknown[] = [];
    const columnFor: [keyof ShopProductWriteRow, string][] = [
      ['sku', 'sku'],
      ['name', 'name'],
      ['slug', 'slug'],
      ['description', 'description'],
      ['categoryId', 'category_id'],
      ['priceGoldCopper', 'price_gold_copper'],
      ['priceClaudium', 'price_claudium'],
      ['priceUsdCents', 'price_usd_cents'],
      ['railSol', 'rail_sol'],
      ['railUsdc', 'rail_usdc'],
      ['railWoc', 'rail_woc'],
      ['status', 'status'],
      ['featured', 'featured'],
      ['grantKind', 'grant_kind'],
      ['grantItemId', 'grant_item_id'],
      ['grantQuantity', 'grant_quantity'],
      ['icon', 'icon'],
      ['displayOrder', 'display_order'],
      ['rarity', 'rarity'],
      ['badges', 'badges'],
      ['isEvent', 'is_event'],
      ['isLimited', 'is_limited'],
      ['discountPercent', 'discount_percent'],
      ['bannerImage', 'banner_image'],
      ['previewImage', 'preview_image'],
      ['announcementTemplate', 'announcement_template'],
    ];
    for (const [key, column] of columnFor) {
      if (patch[key] === undefined) continue;
      values.push(patch[key]);
      sets.push(`${column} = $${values.length}`);
    }
    if (sets.length === 0) return this.getProduct(id);
    sets.push('updated_at = now()');
    values.push(id);
    const res = await this.pool.query(
      `UPDATE shop_products SET ${sets.join(', ')} WHERE id = $${values.length}
       RETURNING ${PRODUCT_COLS}`,
      values,
    );
    return res.rows[0] ? toRecord(res.rows[0]) : null;
  }

  async deleteProduct(id: number): Promise<boolean> {
    const res = await this.pool.query('DELETE FROM shop_products WHERE id = $1 RETURNING id', [id]);
    return (res.rowCount ?? 0) > 0;
  }
}
