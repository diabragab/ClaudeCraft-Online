// Admin-only CRUD surface for the shop catalog's products. Every route is
// gated by requireAdmin (server/admin.ts, the SAME instance server/admin.ts's
// own routes mount): 'shop.read' for the reads, 'shop.manage' for the writes.
// The business rules stay in shop_products.ts (zero HTTP); this module owns
// the RouteDefs, the request-shape schemas, and the service singleton wired
// to Postgres.

import { requireAdmin } from './admin';
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
import { bool, enum_, type Infer, num, object, optional, str } from './http/schema';
import type { Ctx, RouteDef } from './http/types';
import { PgShopCategoriesDb } from './shop_categories_db';
import { type ShopProductErrorCode, ShopProductsService, shopProductJson } from './shop_products';
import { PgShopProductsDb } from './shop_products_db';

// ---------------------------------------------------------------------------
// The service singleton. Construction is pure (the Pg*Db classes only store
// the pool reference; no query runs until a request). The setter lets a unit
// test drive the routes with an in-memory fake (see maps_routes.ts).
// ---------------------------------------------------------------------------

const REAL_SHOP_PRODUCTS_SERVICE = new ShopProductsService(
  new PgShopProductsDb(pool),
  new PgShopCategoriesDb(pool),
);
let productsServiceInstance: ShopProductsService = REAL_SHOP_PRODUCTS_SERVICE;

/** Override the shop products service with a fake (test-only). */
export function setShopProductsServiceForTests(service: ShopProductsService): void {
  productsServiceInstance = service;
}

/** Restore the real Postgres-backed shop products service (test-only). */
export function resetShopProductsServiceForTests(): void {
  productsServiceInstance = REAL_SHOP_PRODUCTS_SERVICE;
}

function productsService(): ShopProductsService {
  return productsServiceInstance;
}

// ---------------------------------------------------------------------------
// Request-shape schemas. See shop_products.ts's header comment for the wire
// conventions (categoryId=0 means uncategorized; each price field is a wire
// string, '' meaning no price).
// ---------------------------------------------------------------------------

const PRICE_MAX_LEN = 20;
const productStatusEnum = enum_(['draft', 'active', 'archived']);
const productSortEnum = enum_(['name', 'createdAt', 'updatedAt', 'displayOrder']);
const sortDirEnum = enum_(['asc', 'desc']);
const productGrantKindEnum = enum_(['none', 'weapon_skin', 'item']);

const listProductsQuerySchema = object({
  page: optional(num({ int: true, min: 1 }), 1),
  limit: optional(num({ int: true, min: 1, max: 100 }), 20),
  q: optional(str({ maxLength: 64 }), ''),
  categoryId: optional(num({ int: true, min: 0 })),
  status: optional(productStatusEnum),
  featured: optional(bool()),
  sort: optional(productSortEnum, 'updatedAt'),
  dir: optional(sortDirEnum, 'desc'),
});

const createProductBodySchema = object({
  sku: str({ minLength: 1, maxLength: 64 }),
  name: str({ minLength: 1, maxLength: 120 }),
  slug: str({ minLength: 1, maxLength: 80 }),
  description: optional(str({ maxLength: 2000 }), ''),
  categoryId: optional(num({ int: true, min: 0 }), 0),
  priceGoldCopper: optional(str({ maxLength: PRICE_MAX_LEN }), ''),
  priceClaudium: optional(str({ maxLength: PRICE_MAX_LEN }), ''),
  priceUsdCents: optional(str({ maxLength: PRICE_MAX_LEN }), ''),
  railSol: optional(bool(), false),
  railUsdc: optional(bool(), false),
  railWoc: optional(bool(), false),
  status: optional(productStatusEnum, 'draft'),
  featured: optional(bool(), false),
  grantKind: optional(productGrantKindEnum, 'none'),
  grantItemId: optional(str({ maxLength: 64 }), ''),
  grantQuantity: optional(str({ maxLength: 10 }), ''),
  icon: optional(str({ maxLength: 300 }), ''),
  displayOrder: optional(num({ int: true, min: 0 }), 0),
});

const updateProductBodySchema = object({
  sku: optional(str({ minLength: 1, maxLength: 64 })),
  name: optional(str({ minLength: 1, maxLength: 120 })),
  slug: optional(str({ minLength: 1, maxLength: 80 })),
  description: optional(str({ maxLength: 2000 })),
  categoryId: optional(num({ int: true, min: 0 })),
  priceGoldCopper: optional(str({ maxLength: PRICE_MAX_LEN })),
  priceClaudium: optional(str({ maxLength: PRICE_MAX_LEN })),
  priceUsdCents: optional(str({ maxLength: PRICE_MAX_LEN })),
  railSol: optional(bool()),
  railUsdc: optional(bool()),
  railWoc: optional(bool()),
  status: optional(productStatusEnum),
  featured: optional(bool()),
  grantKind: optional(productGrantKindEnum),
  grantItemId: optional(str({ maxLength: 64 })),
  grantQuantity: optional(str({ maxLength: 10 })),
  icon: optional(str({ maxLength: 300 })),
  displayOrder: optional(num({ int: true, min: 0 })),
});

export type ListProductsQuery = Infer<typeof listProductsQuerySchema>;
export type CreateProductBody = Infer<typeof createProductBodySchema>;
export type UpdateProductBody = Infer<typeof updateProductBodySchema>;

/**
 * Map a domain-rule rejection to the shared shop HttpError codes (see
 * error_codes.ts). The admin envelope never spreads HttpError params into the
 * response body, so the specific ShopProductErrorCode reason
 * (invalid_slug/invalid_price/no_price/rails_need_usd_price) is not sent to
 * the client; every remaining rejection maps to the one shared 400 code.
 */
function shopProductError(error: ShopProductErrorCode): HttpError {
  if (error === 'not_found' || error === 'category_not_found') {
    return new HttpError(404, 'shop.not_found');
  }
  return new HttpError(400, 'shop.invalid_input');
}

// ---------------------------------------------------------------------------
// Handlers.
// ---------------------------------------------------------------------------

/** GET /admin/api/shop/products: paginated, searchable, filterable, sortable list. */
async function listHandler(ctx: Ctx): Promise<void> {
  const decoded = listProductsQuerySchema.decode(ctx.query);
  if (!decoded.ok) throw decoded;
  const { rows, total } = await productsService().listProducts(decoded.value);
  adminOk(ctx.res, {
    rows: rows.map(shopProductJson),
    total,
    page: decoded.value.page,
    limit: decoded.value.limit,
  });
}

/** POST /admin/api/shop/products: create a product. */
async function createHandler(ctx: Ctx): Promise<void> {
  const decoded = createProductBodySchema.decode(ctx.body ?? {});
  if (!decoded.ok) throw decoded;
  const result = await productsService().createProduct(decoded.value);
  if (!result.ok) throw shopProductError(result.error);
  adminOk(ctx.res, shopProductJson(result.product));
}

/** GET /admin/api/shop/products/:id: a single product. */
async function getHandler(ctx: Ctx): Promise<void> {
  const product = await productsService().getProduct(adminTargetId(ctx));
  if (!product) throw new HttpError(404, 'shop.not_found');
  adminOk(ctx.res, shopProductJson(product));
}

/** POST /admin/api/shop/products/:id: partial update. */
async function updateHandler(ctx: Ctx): Promise<void> {
  const decoded = updateProductBodySchema.decode(ctx.body ?? {});
  if (!decoded.ok) throw decoded;
  const result = await productsService().updateProduct(adminTargetId(ctx), decoded.value);
  if (!result.ok) throw shopProductError(result.error);
  adminOk(ctx.res, shopProductJson(result.product));
}

/** POST /admin/api/shop/products/:id/delete: delete a product (its inventory row cascades). */
async function deleteHandler(ctx: Ctx): Promise<void> {
  const deleted = await productsService().deleteProduct(adminTargetId(ctx));
  if (!deleted) throw new HttpError(404, 'shop.not_found');
  adminOk(ctx.res, { ok: true });
}

// ---------------------------------------------------------------------------
// The route table. registry.ts spreads this into apiRoutes.
// ---------------------------------------------------------------------------

export const routes: RouteDef[] = [
  {
    method: 'GET',
    path: '/admin/api/shop/products',
    surface: 'admin',
    middleware: [requireAdmin],
    meta: ADMIN_META,
    handler: listHandler,
  },
  {
    method: 'POST',
    path: '/admin/api/shop/products',
    surface: 'admin',
    middleware: [requireAdmin, withBody()],
    meta: ADMIN_META,
    handler: createHandler,
  },
  {
    method: 'GET',
    path: '/admin/api/shop/products/:id',
    surface: 'admin',
    middleware: [requireAdmin, requireAdminTarget('shop_product')],
    meta: adminTargetMeta('shop_product'),
    handler: getHandler,
  },
  {
    // POST, not PUT: requireAdmin's central authorization gate
    // (server/http/middleware/require_admin.ts) only accepts GET/POST, like
    // every other admin-surface route.
    method: 'POST',
    path: '/admin/api/shop/products/:id',
    surface: 'admin',
    middleware: [requireAdmin, withBody(), requireAdminTarget('shop_product')],
    meta: adminTargetMeta('shop_product'),
    handler: updateHandler,
  },
  {
    // A literal /delete suffix, not the DELETE method (unsupported here), the
    // same shape as POST /admin/api/maps/:id/unpublish.
    method: 'POST',
    path: '/admin/api/shop/products/:id/delete',
    surface: 'admin',
    middleware: [requireAdmin, requireAdminTarget('shop_product')],
    meta: adminTargetMeta('shop_product'),
    handler: deleteHandler,
  },
];
