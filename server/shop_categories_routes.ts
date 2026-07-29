// Admin-only CRUD surface for the shop catalog's category tree. Every route is
// gated by requireAdmin (server/admin.ts, the SAME instance server/admin.ts's
// own routes mount, not a parallel gate): a 'shop.read' permission for the
// reads, 'shop.manage' for the writes (server/admin_permissions.ts +
// server/admin_routes.ts). The business rules stay in shop_categories.ts (zero
// HTTP); this module owns the RouteDefs, the request-shape schemas, and the
// service singleton wired to Postgres.

import { pool } from './db';
import { adminOk } from './http/admin_envelope';
import { HttpError } from './http/errors';
import { withBody } from './http/middleware/body';
import {
  ADMIN_META,
  adminTargetId,
  adminTargetMeta,
  requireAdminTarget,
} from './http/middleware/require_admin';
import { enum_, type Infer, num, object, optional, str } from './http/schema';
import type { Ctx, RouteDef } from './http/types';
import { requireAdmin } from './admin';
import {
  ShopCategoriesService,
  type ShopCategoryErrorCode,
  shopCategoryJson,
} from './shop_categories';
import { PgShopCategoriesDb } from './shop_categories_db';

// ---------------------------------------------------------------------------
// The service singleton. Construction is pure (PgShopCategoriesDb stores the
// pool reference; no query runs until a request), so module-scope wiring is
// safe for every harness that imports main.ts without a database. The setter
// lets a unit test drive the routes with an in-memory fake (see maps_routes.ts
// for the identical pattern).
// ---------------------------------------------------------------------------

const REAL_SHOP_CATEGORIES_SERVICE = new ShopCategoriesService(new PgShopCategoriesDb(pool));
let categoriesServiceInstance: ShopCategoriesService = REAL_SHOP_CATEGORIES_SERVICE;

/** Override the shop categories service with a fake (test-only). */
export function setShopCategoriesServiceForTests(service: ShopCategoriesService): void {
  categoriesServiceInstance = service;
}

/** Restore the real Postgres-backed shop categories service (test-only). */
export function resetShopCategoriesServiceForTests(): void {
  categoriesServiceInstance = REAL_SHOP_CATEGORIES_SERVICE;
}

function categoriesService(): ShopCategoriesService {
  return categoriesServiceInstance;
}

// ---------------------------------------------------------------------------
// Request-shape schemas. See shop_categories.ts's header comment for the
// parentId=0-means-root wire convention.
// ---------------------------------------------------------------------------

const categoryStatusEnum = enum_(['active', 'archived']);
const categorySortEnum = enum_(['name', 'sortOrder', 'createdAt']);
const sortDirEnum = enum_(['asc', 'desc']);

const listCategoriesQuerySchema = object({
  page: optional(num({ int: true, min: 1 }), 1),
  limit: optional(num({ int: true, min: 1, max: 100 }), 20),
  q: optional(str({ maxLength: 64 }), ''),
  parentId: optional(num({ int: true, min: 0 })),
  status: optional(categoryStatusEnum),
  sort: optional(categorySortEnum, 'sortOrder'),
  dir: optional(sortDirEnum, 'asc'),
});

const createCategoryBodySchema = object({
  name: str({ minLength: 1, maxLength: 120 }),
  slug: str({ minLength: 1, maxLength: 80 }),
  description: optional(str({ maxLength: 2000 }), ''),
  parentId: optional(num({ int: true, min: 0 }), 0),
  sortOrder: optional(num({ int: true }), 0),
  status: optional(categoryStatusEnum, 'active'),
});

const updateCategoryBodySchema = object({
  name: optional(str({ minLength: 1, maxLength: 120 })),
  slug: optional(str({ minLength: 1, maxLength: 80 })),
  description: optional(str({ maxLength: 2000 })),
  parentId: optional(num({ int: true, min: 0 })),
  sortOrder: optional(num({ int: true })),
  status: optional(categoryStatusEnum),
});

export type ListCategoriesQuery = Infer<typeof listCategoriesQuerySchema>;
export type CreateCategoryBody = Infer<typeof createCategoryBodySchema>;
export type UpdateCategoryBody = Infer<typeof updateCategoryBodySchema>;

/**
 * Map a domain-rule rejection to the shared shop HttpError codes (see
 * error_codes.ts). The admin envelope never spreads HttpError params into the
 * response body, so the specific ShopCategoryErrorCode reason
 * (invalid_slug/parent_not_found/self_parent/parent_cycle) is not sent to the
 * client; every non-not_found rejection maps to the one shared 400 code.
 */
function shopCategoryError(error: ShopCategoryErrorCode): HttpError {
  if (error === 'not_found') return new HttpError(404, 'shop.not_found');
  return new HttpError(400, 'shop.invalid_input');
}

// ---------------------------------------------------------------------------
// Handlers.
// ---------------------------------------------------------------------------

/** GET /admin/api/shop/categories: paginated, searchable, filterable, sortable list. */
async function listHandler(ctx: Ctx): Promise<void> {
  const decoded = listCategoriesQuerySchema.decode(ctx.query);
  if (!decoded.ok) throw decoded;
  const { rows, total } = await categoriesService().listCategories(decoded.value);
  adminOk(ctx.res, {
    rows: rows.map(shopCategoryJson),
    total,
    page: decoded.value.page,
    limit: decoded.value.limit,
  });
}

/** POST /admin/api/shop/categories: create a category. */
async function createHandler(ctx: Ctx): Promise<void> {
  const decoded = createCategoryBodySchema.decode(ctx.body ?? {});
  if (!decoded.ok) throw decoded;
  const result = await categoriesService().createCategory(decoded.value);
  if (!result.ok) throw shopCategoryError(result.error);
  adminOk(ctx.res, shopCategoryJson(result.category));
}

/** GET /admin/api/shop/categories/:id: a single category. */
async function getHandler(ctx: Ctx): Promise<void> {
  const category = await categoriesService().getCategory(adminTargetId(ctx));
  if (!category) throw new HttpError(404, 'shop.not_found');
  adminOk(ctx.res, shopCategoryJson(category));
}

/** POST /admin/api/shop/categories/:id: partial update. */
async function updateHandler(ctx: Ctx): Promise<void> {
  const decoded = updateCategoryBodySchema.decode(ctx.body ?? {});
  if (!decoded.ok) throw decoded;
  const result = await categoriesService().updateCategory(adminTargetId(ctx), decoded.value);
  if (!result.ok) throw shopCategoryError(result.error);
  adminOk(ctx.res, shopCategoryJson(result.category));
}

/** POST /admin/api/shop/categories/:id/delete: delete a category (products fall back to uncategorized). */
async function deleteHandler(ctx: Ctx): Promise<void> {
  const deleted = await categoriesService().deleteCategory(adminTargetId(ctx));
  if (!deleted) throw new HttpError(404, 'shop.not_found');
  adminOk(ctx.res, { ok: true });
}

// ---------------------------------------------------------------------------
// The route table. registry.ts spreads this into apiRoutes. Every route carries
// requireAdmin; each :id route also carries requireAdminTarget (operator-
// scope loader, no per-object ownership check: see require_admin.ts).
// ---------------------------------------------------------------------------

export const routes: RouteDef[] = [
  {
    method: 'GET',
    path: '/admin/api/shop/categories',
    surface: 'admin',
    middleware: [requireAdmin],
    meta: ADMIN_META,
    handler: listHandler,
  },
  {
    method: 'POST',
    path: '/admin/api/shop/categories',
    surface: 'admin',
    middleware: [requireAdmin, withBody()],
    meta: ADMIN_META,
    handler: createHandler,
  },
  {
    method: 'GET',
    path: '/admin/api/shop/categories/:id',
    surface: 'admin',
    middleware: [requireAdmin, requireAdminTarget('shop_category')],
    meta: adminTargetMeta('shop_category'),
    handler: getHandler,
  },
  {
    // POST, not PUT: requireAdmin's central authorization gate
    // (server/http/middleware/require_admin.ts) only accepts GET/POST, like
    // every other admin-surface route.
    method: 'POST',
    path: '/admin/api/shop/categories/:id',
    surface: 'admin',
    middleware: [requireAdmin, withBody(), requireAdminTarget('shop_category')],
    meta: adminTargetMeta('shop_category'),
    handler: updateHandler,
  },
  {
    // A literal /delete suffix, not the DELETE method (unsupported here), the
    // same shape as POST /admin/api/maps/:id/unpublish.
    method: 'POST',
    path: '/admin/api/shop/categories/:id/delete',
    surface: 'admin',
    middleware: [requireAdmin, requireAdminTarget('shop_category')],
    meta: adminTargetMeta('shop_category'),
    handler: deleteHandler,
  },
];
