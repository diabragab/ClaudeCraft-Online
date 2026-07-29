// Public (anonymous) storefront catalog surface (Phase 4): read-only browsing
// over the Phase 1 catalog. Every handler is a thin wrapper over the EXISTING
// ShopCategoriesService / ShopProductsService / ShopInventoryService (the same
// classes server/shop_categories_routes.ts etc. use for the admin surface);
// this module adds no catalog business logic of its own beyond forcing
// status: 'active' server-side (never trusting a client-supplied status) so a
// draft/archived row is never exposed publicly, and merging in the display-only
// availability from server/shop_storefront.ts. Reads carry the same per-IP
// public-read budget deeds.ts's rarity read and the character-sheet/search
// routes already use (server/ratelimit.ts).

import { pool } from './db';
import { json } from './http_util';
import { HttpError } from './http/errors';
import { num, object, optional, str, bool, enum_ } from './http/schema';
import type { Ctx, RouteDef } from './http/types';
import { publicReadRateLimited } from './ratelimit';
import { PgShopCategoriesDb } from './shop_categories_db';
import { ShopCategoriesService, shopCategoryJson } from './shop_categories';
import { PgShopInventoryDb } from './shop_inventory_db';
import { ShopInventoryService } from './shop_inventory';
import { PgShopProductsDb } from './shop_products_db';
import { ShopProductsService } from './shop_products';
import { toStorefrontProduct } from './shop_storefront';

// ---------------------------------------------------------------------------
// Service singletons. Same construction shape as the admin shop routes
// (server/shop_products_routes.ts etc.): pure until a request runs. Setters
// let a unit test drive the routes with in-memory fakes.
// ---------------------------------------------------------------------------

const REAL_CATEGORIES_SERVICE = new ShopCategoriesService(new PgShopCategoriesDb(pool));
const REAL_PRODUCTS_SERVICE = new ShopProductsService(
  new PgShopProductsDb(pool),
  new PgShopCategoriesDb(pool),
);
const REAL_INVENTORY_SERVICE = new ShopInventoryService(
  new PgShopInventoryDb(pool),
  new PgShopProductsDb(pool),
);

let categoriesService = REAL_CATEGORIES_SERVICE;
let productsService = REAL_PRODUCTS_SERVICE;
let inventoryService = REAL_INVENTORY_SERVICE;

export function setStorefrontCatalogServicesForTests(services: {
  categories?: ShopCategoriesService;
  products?: ShopProductsService;
  inventory?: ShopInventoryService;
}): void {
  if (services.categories) categoriesService = services.categories;
  if (services.products) productsService = services.products;
  if (services.inventory) inventoryService = services.inventory;
}

export function resetStorefrontCatalogServicesForTests(): void {
  categoriesService = REAL_CATEGORIES_SERVICE;
  productsService = REAL_PRODUCTS_SERVICE;
  inventoryService = REAL_INVENTORY_SERVICE;
}

// ---------------------------------------------------------------------------
// Request-shape schemas. No `status` field on the wire anywhere here: the
// storefront always forces 'active' server-side.
// ---------------------------------------------------------------------------

const categorySortEnum = enum_(['name', 'sortOrder', 'createdAt']);
const productSortEnum = enum_(['name', 'createdAt', 'updatedAt']);
const sortDirEnum = enum_(['asc', 'desc']);

const listCategoriesQuerySchema = object({
  page: optional(num({ int: true, min: 1 }), 1),
  limit: optional(num({ int: true, min: 1, max: 100 }), 20),
  q: optional(str({ maxLength: 64 }), ''),
  parentId: optional(num({ int: true, min: 0 })),
  sort: optional(categorySortEnum, 'sortOrder'),
  dir: optional(sortDirEnum, 'asc'),
});

const listProductsQuerySchema = object({
  page: optional(num({ int: true, min: 1 }), 1),
  limit: optional(num({ int: true, min: 1, max: 100 }), 20),
  q: optional(str({ maxLength: 64 }), ''),
  categoryId: optional(num({ int: true, min: 0 })),
  featured: optional(bool()),
  sort: optional(productSortEnum, 'createdAt'),
  dir: optional(sortDirEnum, 'desc'),
});

// ---------------------------------------------------------------------------
// Handlers.
// ---------------------------------------------------------------------------

function rateLimitOr429(ctx: Ctx): boolean {
  if (publicReadRateLimited(ctx.req).allowed) return true;
  json(ctx.res, 429, { error: 'rate limited', code: 'rate_limit.exceeded' });
  return false;
}

/** GET /api/shop/categories: paginated, searchable, sortable, active-only. */
async function listCategoriesHandler(ctx: Ctx): Promise<void> {
  if (!rateLimitOr429(ctx)) return;
  const decoded = listCategoriesQuerySchema.decode(ctx.query);
  if (!decoded.ok) throw decoded;
  const { rows, total } = await categoriesService.listCategories({
    ...decoded.value,
    status: 'active',
  });
  json(ctx.res, 200, {
    rows: rows.map(shopCategoryJson),
    total,
    page: decoded.value.page,
    limit: decoded.value.limit,
  });
}

/** GET /api/shop/categories/:slug: one active category by slug. */
async function getCategoryHandler(ctx: Ctx): Promise<void> {
  if (!rateLimitOr429(ctx)) return;
  const slug = ctx.params.slug ?? '';
  const category = await categoriesService.getCategoryBySlug(slug);
  if (!category || category.status !== 'active') throw new HttpError(404, 'shop.not_found');
  json(ctx.res, 200, shopCategoryJson(category));
}

/** GET /api/shop/products: paginated, searchable, filterable, sortable, active-only. */
async function listProductsHandler(ctx: Ctx): Promise<void> {
  if (!rateLimitOr429(ctx)) return;
  const decoded = listProductsQuerySchema.decode(ctx.query);
  if (!decoded.ok) throw decoded;
  const { rows, total } = await productsService.listProducts({
    ...decoded.value,
    status: 'active',
  });
  const storefrontRows = await Promise.all(
    rows.map(async (product) => {
      const inventory = await inventoryService.getInventoryByProduct(product.id);
      return toStorefrontProduct(product, inventory);
    }),
  );
  json(ctx.res, 200, {
    rows: storefrontRows,
    total,
    page: decoded.value.page,
    limit: decoded.value.limit,
  });
}

/** GET /api/shop/products/:slug: one active product by slug, with availability. */
async function getProductHandler(ctx: Ctx): Promise<void> {
  if (!rateLimitOr429(ctx)) return;
  const slug = ctx.params.slug ?? '';
  const product = await productsService.getProductBySlug(slug);
  if (!product || product.status !== 'active') throw new HttpError(404, 'shop.not_found');
  const inventory = await inventoryService.getInventoryByProduct(product.id);
  const category = product.categoryId !== null ? await categoriesService.getCategory(product.categoryId) : null;
  json(ctx.res, 200, {
    ...toStorefrontProduct(product, inventory),
    category: category ? shopCategoryJson(category) : null,
  });
}

// ---------------------------------------------------------------------------
// The route table. registry.ts spreads this into apiRoutes. Registry-only:
// no legacy ladder twin (a brand-new player-facing surface).
// ---------------------------------------------------------------------------

export const routes: RouteDef[] = [
  {
    method: 'GET',
    path: '/api/shop/categories',
    surface: 'api',
    handler: listCategoriesHandler,
  },
  {
    method: 'GET',
    path: '/api/shop/categories/:slug',
    surface: 'api',
    meta: { publicRead: true },
    handler: getCategoryHandler,
  },
  {
    method: 'GET',
    path: '/api/shop/products',
    surface: 'api',
    handler: listProductsHandler,
  },
  {
    method: 'GET',
    path: '/api/shop/products/:slug',
    surface: 'api',
    meta: { publicRead: true },
    handler: getProductHandler,
  },
];
