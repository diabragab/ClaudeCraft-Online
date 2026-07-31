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
export type ShopProductSort = 'name' | 'createdAt' | 'updatedAt' | 'displayOrder';
// What a purchase of this product delivers (Phase 5, the in-game Shop).
// 'none' is every product predating this column (web-storefront-only
// products with no automated delivery, admin fulfills manually). 'weapon_skin'
// reuses the Season 1 Armory account-cosmetics grant; 'item' mails
// grantQuantity of grantItemId (a sim ITEMS key) to the buyer's live
// character. See server/shop_delivery.ts for the delivery path.
export type ShopProductGrantKind = 'none' | 'weapon_skin' | 'item';

// Premium Shop: a product's own merchandising rarity, independent of any
// in-game item quality (src/ui/icons.ts QUALITY_COLOR) or weapon-skin rarity
// (src/sim/content/weapon_skins.ts WeaponSkinRarity) the grant target might
// carry (not every product grants an item with a quality: a Claudium
// package or a pure-cosmetic product has none), so this is its own closed
// vocabulary. 'common' (the bottom tier) is the correct default for every
// product predating this column.
export const RARITY_TIERS = [
  'common',
  'uncommon',
  'rare',
  'epic',
  'legendary',
  'mythic',
] as const;
export type ShopRarity = (typeof RARITY_TIERS)[number];

// The closed badge vocabulary an operator may pin to a product (Products
// admin page). Purely a merchandising signal, like `featured` above; a
// product may carry any subset, including none.
export const SHOP_BADGES = [
  'new',
  'hot',
  'featured',
  'best_value',
  'limited',
  'sale',
  'event',
  'exclusive',
  'popular',
] as const;
export type ShopBadge = (typeof SHOP_BADGES)[number];

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
  /** An admin-set icon URL/asset path, or null to fall back to the client's grant-based icon. */
  icon: string | null;
  /** Admin-controlled sort key for storefront/admin ordering (Enable/Disable, Feature, Reorder). */
  displayOrder: number;
  /** Premium Shop merchandising rarity; drives the card border/glow/animation tier. */
  rarity: ShopRarity;
  /** Zero or more badges from the closed SHOP_BADGES vocabulary. */
  badges: ShopBadge[];
  /** Event-catalog flag; pairs with (but is independent of) the 'event' badge. */
  isEvent: boolean;
  /** Limited-time-offer flag, independent of physical stock (see shop_inventory). */
  isLimited: boolean;
  /** 1-99, or null for no discount. Drives the SALE badge + a strikethrough price display. */
  discountPercent: number | null;
  /** A promotional banner image URL for the featured carousel, or null. */
  bannerImage: string | null;
  /** A larger promotional preview image URL (distinct from `icon`), or null. */
  previewImage: string | null;
  /** Per-product override of the global announcement message template, or null to use the default. */
  announcementTemplate: string | null;
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
  /** Admin/storefront: filter to an exact rarity tier when set. */
  rarity?: ShopRarity;
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
  /** '' means no icon (stored as SQL NULL), same convention as the price fields. */
  icon: string;
  displayOrder: number;
  rarity: ShopRarity;
  badges: ShopBadge[];
  isEvent: boolean;
  isLimited: boolean;
  /** Wire string, same convention as the price fields; '' means no discount. */
  discountPercent: string;
  /** '' means no banner (stored as SQL NULL), same convention as `icon`. */
  bannerImage: string;
  /** '' means no preview image (stored as SQL NULL), same convention as `icon`. */
  previewImage: string;
  /** '' means no override (stored as SQL NULL), same convention as `icon`. */
  announcementTemplate: string;
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
  icon?: string;
  displayOrder?: number;
  rarity?: ShopRarity;
  badges?: ShopBadge[];
  isEvent?: boolean;
  isLimited?: boolean;
  discountPercent?: string;
  bannerImage?: string;
  previewImage?: string;
  announcementTemplate?: string;
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
  icon: string | null;
  displayOrder: number;
  rarity: ShopRarity;
  badges: ShopBadge[];
  isEvent: boolean;
  isLimited: boolean;
  discountPercent: number | null;
  bannerImage: string | null;
  previewImage: string | null;
  announcementTemplate: string | null;
}

export type ShopProductErrorCode =
  | 'invalid_slug'
  | 'invalid_price'
  | 'no_price'
  | 'rails_need_usd_price'
  | 'category_not_found'
  | 'invalid_grant'
  | 'invalid_discount'
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

// 'enabled' is not its own column: Enable/Disable (per the admin CRUD spec) toggles
// between status 'active' and 'archived', the same status enum every other rule here
// already keys off, so there is only ever one source of truth for availability.
export function shopProductJson(product: ShopProductRecord): Record<string, unknown> {
  return { ...product, enabled: product.status === 'active' };
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

/** Parse an optional wire discount-percent string: '' means no discount, else 1-99. */
function parseDiscountField(raw: string): number | null | 'invalid' {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  if (!/^\d+$/.test(trimmed)) return 'invalid';
  const value = Number(trimmed);
  return Number.isSafeInteger(value) && value >= 1 && value <= 99 ? value : 'invalid';
}

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

    const iconRaw = (input.icon ?? existing?.icon ?? '').trim();
    const icon = iconRaw === '' ? null : iconRaw;
    const displayOrder = input.displayOrder ?? existing?.displayOrder ?? 0;

    const rarity = input.rarity ?? existing?.rarity ?? 'common';
    if (!RARITY_TIERS.includes(rarity)) return { ok: false, error: 'invalid_grant' };
    const badges = input.badges ?? existing?.badges ?? [];
    if (badges.some((b) => !SHOP_BADGES.includes(b))) return { ok: false, error: 'invalid_grant' };
    const isEvent = input.isEvent ?? existing?.isEvent ?? false;
    const isLimited = input.isLimited ?? existing?.isLimited ?? false;
    const discountPercent = parseDiscountField(
      input.discountPercent ?? String(existing?.discountPercent ?? ''),
    );
    if (discountPercent === 'invalid') return { ok: false, error: 'invalid_discount' };
    const bannerImageRaw = (input.bannerImage ?? existing?.bannerImage ?? '').trim();
    const bannerImage = bannerImageRaw === '' ? null : bannerImageRaw;
    const previewImageRaw = (input.previewImage ?? existing?.previewImage ?? '').trim();
    const previewImage = previewImageRaw === '' ? null : previewImageRaw;
    const announcementTemplateRaw = (
      input.announcementTemplate ??
      existing?.announcementTemplate ??
      ''
    ).trim();
    const announcementTemplate = announcementTemplateRaw === '' ? null : announcementTemplateRaw;

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
        icon,
        displayOrder,
        rarity,
        badges,
        isEvent,
        isLimited,
        discountPercent,
        bannerImage,
        previewImage,
        announcementTemplate,
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
    if (input.icon !== undefined) patch.icon = resolved.row.icon;
    if (input.displayOrder !== undefined) patch.displayOrder = resolved.row.displayOrder;
    if (input.rarity !== undefined) patch.rarity = resolved.row.rarity;
    if (input.badges !== undefined) patch.badges = resolved.row.badges;
    if (input.isEvent !== undefined) patch.isEvent = resolved.row.isEvent;
    if (input.isLimited !== undefined) patch.isLimited = resolved.row.isLimited;
    if (input.discountPercent !== undefined) patch.discountPercent = resolved.row.discountPercent;
    if (input.bannerImage !== undefined) patch.bannerImage = resolved.row.bannerImage;
    if (input.previewImage !== undefined) patch.previewImage = resolved.row.previewImage;
    if (input.announcementTemplate !== undefined) {
      patch.announcementTemplate = resolved.row.announcementTemplate;
    }
    const product = await this.db.updateProduct(id, patch);
    if (!product) return { ok: false, error: 'not_found' };
    return { ok: true, product };
  }

  deleteProduct(id: number): Promise<boolean> {
    return this.db.deleteProduct(id);
  }
}
