// Shop catalog: product business rules. Mirrors the ShopCategoriesService split
// (itself mirroring SocialService/MapsService): validation and cross-row rules
// against a narrow ShopProductsDb interface, zero SQL, zero HTTP. Field SHAPE
// is validated one layer up by shop_products_routes.ts via server/http/schema.ts;
// this module enforces rules schema.ts cannot express: the slug charset, the
// "at least one price is set" and "a crypto rail needs a USD price" business
// rules, and category existence.
//
// Wire conventions (kept in lockstep with shop_categories.ts):
//  - categoryId is always a non-negative integer; 0 means "uncategorized" and
//    is stored as SQL NULL.
//  - Each price field travels as a STRING: a non-negative integer string, or
//    an empty string meaning "no price set" (clears the price on update).
//    Strings avoid two real problems a bare number would not solve: (a) an
//    explicit "clear this price" signal, which schema.ts's numeric combinator
//    cannot express without a nullable() it does not have (the same problem
//    shop_categories.ts solves with a 0 sentinel, which does not work here
//    since 0 is a legitimate free-item price); and (b) copper-denominated gold
//    prices are BIGINT in Postgres and can in principle exceed
//    Number.MAX_SAFE_INTEGER, so keeping them as strings on the wire avoids a
//    silent float-precision loss for an unusually large value.

import { validSlugFormat } from './shop_slug';

export type ShopProductStatus = 'draft' | 'active' | 'archived';
export type ShopSortDirection = 'asc' | 'desc';
export type ShopProductSort = 'name' | 'createdAt' | 'updatedAt';
// What a purchase of this product delivers (Phase 5, the in-game Shop).
// 'none' is every product predating this column (web-storefront-only
// products with no automated delivery, admin fulfills manually). 'weapon_skin'
// reuses the Season 1 Armory account-cosmetics grant; 'item' mails
// grantQuantity of grantItemId (a sim ITEMS key) to the buyer's live
// character. See server/shop_claudium_checkout.ts for the delivery path.
export type ShopProductGrantKind = 'none' | 'weapon_skin' | 'item';

export interface ShopProductRecord {
  id: number;
  sku: string;
  name: string;
  slug: string;
  description: string;
  categoryId: number | null;
  priceGoldCopper: number | null;
  priceClaudium: number | null;
  priceUsdCents: number | null;
  railSol: boolean;
  railUsdc: boolean;
  railWoc: boolean;
  status: ShopProductStatus;
  // Curated by an operator (Products admin page); drives the storefront's
  // "Featured products" section (Phase 4). Purely a merchandising flag, no
  // effect on price/availability/ordering rules.
  featured: boolean;
  grantKind: ShopProductGrantKind;
  grantItemId: string | null;
  grantQuantity: number;
  createdAt: string;
  updatedAt: string;
}

export interface ShopProductListParams {
  page: number;
  limit: number;
  q: string;
  /** 0 = uncategorized filter; undefined = no filter. */
  categoryId?: number;
  status?: ShopProductStatus;
  /** Storefront (Phase 4): filter to featured=true only when set. */
  featured?: boolean;
  sort: ShopProductSort;
  dir: ShopSortDirection;
}

/** The already-shape-validated create body. Price fields are raw wire strings. */
export interface ShopProductCreateInput {
  sku: string;
  name: string;
  slug: string;
  description: string;
  categoryId: number;
  priceGoldCopper: string;
  priceClaudium: string;
  priceUsdCents: string;
  railSol: boolean;
  railUsdc: boolean;
  railWoc: boolean;
  status: ShopProductStatus;
  featured: boolean;
  grantKind: ShopProductGrantKind;
  /** Required (non-empty) unless grantKind is 'none'. */
  grantItemId: string;
  /** Wire string, same convention as the price fields; '' means the default of 1. */
  grantQuantity: string;
}

/** The already-shape-validated update body; an absent field means unchanged. */
export interface ShopProductUpdateInput {
  sku?: string;
  name?: string;
  slug?: string;
  description?: string;
  categoryId?: number;
  priceGoldCopper?: string;
  priceClaudium?: string;
  priceUsdCents?: string;
  railSol?: boolean;
  railUsdc?: boolean;
  railWoc?: boolean;
  status?: ShopProductStatus;
  featured?: boolean;
  grantKind?: ShopProductGrantKind;
  grantItemId?: string;
  grantQuantity?: string;
}

/** The insert/update shape the db layer persists: prices resolved to number|null. */
export interface ShopProductWriteRow {
  sku: string;
  name: string;
  slug: string;
  description: string;
  categoryId: number | null;
  priceGoldCopper: number | null;
  priceClaudium: number | null;
  priceUsdCents: number | null;
  railSol: boolean;
  railUsdc: boolean;
  railWoc: boolean;
  status: ShopProductStatus;
  featured: boolean;
  grantKind: ShopProductGrantKind;
  grantItemId: string | null;
  grantQuantity: number;
}

export type ShopProductErrorCode =
  | 'invalid_slug'
  | 'invalid_price'
  | 'no_price'
  | 'rails_need_usd_price'
  | 'category_not_found'
  | 'invalid_grant'
  | 'not_found';

export type ShopProductResult =
  | { ok: true; product: ShopProductRecord }
  | { ok: false; error: ShopProductErrorCode };

// Storage abstraction. The Postgres implementation (shop_products_db.ts) owns
// the SQL, including the UNIQUE sku/slug indexes (a violation propagates as a
// pg unique-constraint error, mapped to 409 db.conflict by the shared error
// boundary); the in-memory test fake mirrors that contract.
export interface ShopProductsDb {
  insertProduct(row: ShopProductWriteRow): Promise<ShopProductRecord>;
  getProduct(id: number): Promise<ShopProductRecord | null>;
  /** Storefront (Phase 4) product-detail lookup: the same UNIQUE slug used on the wire. */
  getProductBySlug(slug: string): Promise<ShopProductRecord | null>;
  listProducts(
    params: ShopProductListParams,
  ): Promise<{ rows: ShopProductRecord[]; total: number }>;
  updateProduct(id: number, patch: Partial<ShopProductWriteRow>): Promise<ShopProductRecord | null>;
  deleteProduct(id: number): Promise<boolean>;
}

/** The narrow category-existence read ShopProductsService needs; ShopCategoriesDb satisfies it. */
export interface ShopCategoryLookup {
  getCategory(id: number): Promise<{ id: number } | null>;
}

export function shopProductJson(product: ShopProductRecord): Record<string, unknown> {
  return { ...product };
}

/** Parse an optional wire price string: '' means no price, else a non-negative integer. */
function parsePriceField(raw: string): number | null | 'invalid' {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  if (!/^\d+$/.test(trimmed)) return 'invalid';
  const value = Number(trimmed);
  return Number.isSafeInteger(value) ? value : 'invalid';
}

const GRANT_KINDS: readonly ShopProductGrantKind[] = ['none', 'weapon_skin', 'item'];

/** Parse the wire grantQuantity string: '' means the default of 1, else a positive integer. */
function parseGrantQuantityField(raw: string): number | 'invalid' {
  const trimmed = raw.trim();
  if (trimmed === '') return 1;
  if (!/^\d+$/.test(trimmed)) return 'invalid';
  const value = Number(trimmed);
  return Number.isSafeInteger(value) && value >= 1 ? value : 'invalid';
}

export class ShopProductsService {
  constructor(
    private readonly db: ShopProductsDb,
    private readonly categories: ShopCategoryLookup,
  ) {}

  private async resolveWriteRow(
    input: ShopProductCreateInput | (ShopProductUpdateInput & { sku: string }),
    existing: ShopProductRecord | null,
  ): Promise<{ ok: true; row: ShopProductWriteRow } | { ok: false; error: ShopProductErrorCode }> {
    const slug = input.slug ?? existing?.slug;
    if (slug !== undefined && !validSlugFormat(slug)) return { ok: false, error: 'invalid_slug' };

    const resolvePrice = (
      raw: string | undefined,
      current: number | null,
    ): number | null | 'invalid' => (raw === undefined ? current : parsePriceField(raw));
    const priceGoldCopper = resolvePrice(input.priceGoldCopper, existing?.priceGoldCopper ?? null);
    const priceClaudium = resolvePrice(input.priceClaudium, existing?.priceClaudium ?? null);
    const priceUsdCents = resolvePrice(input.priceUsdCents, existing?.priceUsdCents ?? null);
    if (
      priceGoldCopper === 'invalid' ||
      priceClaudium === 'invalid' ||
      priceUsdCents === 'invalid'
    ) {
      return { ok: false, error: 'invalid_price' };
    }
    if (priceGoldCopper === null && priceClaudium === null && priceUsdCents === null) {
      return { ok: false, error: 'no_price' };
    }

    const railSol = input.railSol ?? existing?.railSol ?? false;
    const railUsdc = input.railUsdc ?? existing?.railUsdc ?? false;
    const railWoc = input.railWoc ?? existing?.railWoc ?? false;
    const featured = input.featured ?? existing?.featured ?? false;
    if ((railSol || railUsdc || railWoc) && priceUsdCents === null) {
      return { ok: false, error: 'rails_need_usd_price' };
    }

    let categoryId: number | null = existing?.categoryId ?? null;
    if (input.categoryId !== undefined) {
      if (input.categoryId === 0) {
        categoryId = null;
      } else {
        const category = await this.categories.getCategory(input.categoryId);
        if (!category) return { ok: false, error: 'category_not_found' };
        categoryId = category.id;
      }
    }

    const grantKind = input.grantKind ?? existing?.grantKind ?? 'none';
    if (!GRANT_KINDS.includes(grantKind)) return { ok: false, error: 'invalid_grant' };
    const grantItemIdRaw = (input.grantItemId ?? existing?.grantItemId ?? '').trim();
    const grantQuantityParsed = parseGrantQuantityField(
      input.grantQuantity ?? String(existing?.grantQuantity ?? ''),
    );
    if (grantQuantityParsed === 'invalid') return { ok: false, error: 'invalid_grant' };
    // 'none' always clears id/quantity to their rest state, whatever the
    // caller sent; a non-'none' kind requires a non-empty item id.
    const grantItemId = grantKind === 'none' ? null : grantItemIdRaw || null;
    if (grantKind !== 'none' && grantItemId === null) {
      return { ok: false, error: 'invalid_grant' };
    }
    const grantQuantity = grantKind === 'none' ? 1 : grantQuantityParsed;

    return {
      ok: true,
      row: {
        sku: input.sku ?? (existing?.sku as string),
        name: input.name ?? (existing?.name as string),
        slug: slug as string,
        description: input.description ?? existing?.description ?? '',
        categoryId,
        priceGoldCopper,
        priceClaudium,
        priceUsdCents,
        railSol,
        railUsdc,
        railWoc,
        status: input.status ?? existing?.status ?? 'draft',
        featured,
        grantKind,
        grantItemId,
        grantQuantity,
      },
    };
  }

  async createProduct(input: ShopProductCreateInput): Promise<ShopProductResult> {
    const resolved = await this.resolveWriteRow(input, null);
    if (!resolved.ok) return resolved;
    const product = await this.db.insertProduct(resolved.row);
    return { ok: true, product };
  }

  getProduct(id: number): Promise<ShopProductRecord | null> {
    return this.db.getProduct(id);
  }

  getProductBySlug(slug: string): Promise<ShopProductRecord | null> {
    return this.db.getProductBySlug(slug);
  }

  listProducts(
    params: ShopProductListParams,
  ): Promise<{ rows: ShopProductRecord[]; total: number }> {
    return this.db.listProducts(params);
  }

  async updateProduct(id: number, input: ShopProductUpdateInput): Promise<ShopProductResult> {
    const existing = await this.db.getProduct(id);
    if (!existing) return { ok: false, error: 'not_found' };
    const resolved = await this.resolveWriteRow(
      { ...input, sku: input.sku ?? existing.sku },
      existing,
    );
    if (!resolved.ok) return resolved;
    const patch: Partial<ShopProductWriteRow> = {};
    if (input.sku !== undefined) patch.sku = resolved.row.sku;
    if (input.name !== undefined) patch.name = resolved.row.name;
    if (input.slug !== undefined) patch.slug = resolved.row.slug;
    if (input.description !== undefined) patch.description = resolved.row.description;
    if (input.categoryId !== undefined) patch.categoryId = resolved.row.categoryId;
    if (input.priceGoldCopper !== undefined) patch.priceGoldCopper = resolved.row.priceGoldCopper;
    if (input.priceClaudium !== undefined) patch.priceClaudium = resolved.row.priceClaudium;
    if (input.priceUsdCents !== undefined) patch.priceUsdCents = resolved.row.priceUsdCents;
    if (input.railSol !== undefined) patch.railSol = resolved.row.railSol;
    if (input.railUsdc !== undefined) patch.railUsdc = resolved.row.railUsdc;
    if (input.railWoc !== undefined) patch.railWoc = resolved.row.railWoc;
    if (input.status !== undefined) patch.status = resolved.row.status;
    if (input.featured !== undefined) patch.featured = resolved.row.featured;
    if (
      input.grantKind !== undefined ||
      input.grantItemId !== undefined ||
      input.grantQuantity !== undefined
    ) {
      patch.grantKind = resolved.row.grantKind;
      patch.grantItemId = resolved.row.grantItemId;
      patch.grantQuantity = resolved.row.grantQuantity;
    }
    const product = await this.db.updateProduct(id, patch);
    if (!product) return { ok: false, error: 'not_found' };
    return { ok: true, product };
  }

  deleteProduct(id: number): Promise<boolean> {
    return this.db.deleteProduct(id);
  }
}
