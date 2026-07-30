// Shop catalog: category-tree business rules. Mirrors the SocialService/SocialDb
// (and MapsService/MapsDb) split: this module holds validation and hierarchy
// rules against a narrow ShopCategoriesDb interface (Postgres implementation in
// shop_categories_db.ts; tests use an in-memory fake) and carries zero SQL and
// zero HTTP. Field SHAPE (types, lengths, enum membership) is validated one
// layer up by shop_categories_routes.ts via server/http/schema.ts; this module
// only enforces rules schema.ts cannot express: the slug charset, and the
// category-tree invariants (a parent must exist, a category cannot parent
// itself, and reassigning a parent cannot create a cycle).
//
// Wire convention: parentId is always a non-negative integer, never null.
// 0 is the "no parent / root category" sentinel (category ids are SERIAL and
// start at 1, so 0 never collides with a real id); the db layer stores it as
// SQL NULL. This keeps every field on the wire a plain number/string/enum, so
// server/http/schema.ts (which has no nullable() combinator) is sufficient for
// the whole shape and no custom validator is needed.

import { validSlugFormat } from './shop_slug';

export type ShopCategoryStatus = 'active' | 'archived';
export type ShopSortDirection = 'asc' | 'desc';
export type ShopCategorySort = 'name' | 'sortOrder' | 'createdAt';

export interface ShopCategoryRecord {
  id: number;
  name: string;
  slug: string;
  description: string;
  parentId: number | null;
  sortOrder: number;
  status: ShopCategoryStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ShopCategoryListParams {
  page: number;
  limit: number;
  q: string;
  /** 0 = root-only filter (parent_id IS NULL); undefined = no filter. */
  parentId?: number;
  status?: ShopCategoryStatus;
  sort: ShopCategorySort;
  dir: ShopSortDirection;
}

/** The already-shape-validated create body (schema.ts decoded parentId 0 -> root). */
export interface ShopCategoryCreateInput {
  name: string;
  slug: string;
  description: string;
  parentId: number;
  sortOrder: number;
  status: ShopCategoryStatus;
}

/** The already-shape-validated update body; an absent field means unchanged. */
export interface ShopCategoryUpdateInput {
  name?: string;
  slug?: string;
  description?: string;
  parentId?: number;
  sortOrder?: number;
  status?: ShopCategoryStatus;
}

/** The insert/update shape the db layer actually persists (parentId resolved to null-or-id). */
export interface ShopCategoryWriteRow {
  name: string;
  slug: string;
  description: string;
  parentId: number | null;
  sortOrder: number;
  status: ShopCategoryStatus;
}

export type ShopCategoryErrorCode =
  | 'invalid_slug'
  | 'parent_not_found'
  | 'self_parent'
  | 'parent_cycle'
  | 'not_found';

export type ShopCategoryResult =
  | { ok: true; category: ShopCategoryRecord }
  | { ok: false; error: ShopCategoryErrorCode };

// Storage abstraction. The Postgres implementation (shop_categories_db.ts) owns
// the SQL (including the UNIQUE slug index; a violation propagates as a pg
// unique-constraint error the route layer's error boundary maps to 409
// db.conflict, the same convention every other domain in this pipeline uses);
// the in-memory test fake mirrors that contract.
export interface ShopCategoriesDb {
  insertCategory(row: ShopCategoryWriteRow): Promise<ShopCategoryRecord>;
  getCategory(id: number): Promise<ShopCategoryRecord | null>;
  /** Storefront (Phase 4) category-page lookup: the same UNIQUE slug used on the wire. */
  getCategoryBySlug(slug: string): Promise<ShopCategoryRecord | null>;
  listCategories(
    params: ShopCategoryListParams,
  ): Promise<{ rows: ShopCategoryRecord[]; total: number }>;
  updateCategory(
    id: number,
    patch: Partial<ShopCategoryWriteRow>,
  ): Promise<ShopCategoryRecord | null>;
  deleteCategory(id: number): Promise<boolean>;
}

export function shopCategoryJson(category: ShopCategoryRecord): Record<string, unknown> {
  return { ...category };
}

export class ShopCategoriesService {
  constructor(private readonly db: ShopCategoriesDb) {}

  async createCategory(input: ShopCategoryCreateInput): Promise<ShopCategoryResult> {
    if (!validSlugFormat(input.slug)) return { ok: false, error: 'invalid_slug' };
    let parentId: number | null = null;
    if (input.parentId !== 0) {
      const parent = await this.db.getCategory(input.parentId);
      if (!parent) return { ok: false, error: 'parent_not_found' };
      parentId = parent.id;
    }
    const category = await this.db.insertCategory({
      name: input.name,
      slug: input.slug,
      description: input.description,
      parentId,
      sortOrder: input.sortOrder,
      status: input.status,
    });
    return { ok: true, category };
  }

  getCategory(id: number): Promise<ShopCategoryRecord | null> {
    return this.db.getCategory(id);
  }

  getCategoryBySlug(slug: string): Promise<ShopCategoryRecord | null> {
    return this.db.getCategoryBySlug(slug);
  }

  listCategories(
    params: ShopCategoryListParams,
  ): Promise<{ rows: ShopCategoryRecord[]; total: number }> {
    return this.db.listCategories(params);
  }

  async updateCategory(id: number, input: ShopCategoryUpdateInput): Promise<ShopCategoryResult> {
    if (input.slug !== undefined && !validSlugFormat(input.slug)) {
      return { ok: false, error: 'invalid_slug' };
    }
    const patch: Partial<ShopCategoryWriteRow> = {
      name: input.name,
      slug: input.slug,
      description: input.description,
      sortOrder: input.sortOrder,
      status: input.status,
    };
    if (input.parentId !== undefined) {
      if (input.parentId === 0) {
        patch.parentId = null;
      } else {
        if (input.parentId === id) return { ok: false, error: 'self_parent' };
        const parent = await this.db.getCategory(input.parentId);
        if (!parent) return { ok: false, error: 'parent_not_found' };
        if (await this.wouldCycle(id, parent.id)) return { ok: false, error: 'parent_cycle' };
        patch.parentId = parent.id;
      }
    }
    const category = await this.db.updateCategory(id, patch);
    if (!category) return { ok: false, error: 'not_found' };
    return { ok: true, category };
  }

  deleteCategory(id: number): Promise<boolean> {
    return this.db.deleteCategory(id);
  }

  // Walk candidateParentId's own parent chain upward; if it ever reaches `id`,
  // making candidateParentId the new parent of `id` would close a cycle. Caps
  // the walk at the live row count via a seen-set so a pre-existing cycle
  // (should one ever exist) cannot spin forever.
  private async wouldCycle(id: number, candidateParentId: number): Promise<boolean> {
    let current: number | null = candidateParentId;
    const seen = new Set<number>();
    while (current !== null) {
      if (current === id) return true;
      if (seen.has(current)) return false;
      seen.add(current);
      const row = await this.db.getCategory(current);
      current = row ? row.parentId : null;
    }
    return false;
  }
}
