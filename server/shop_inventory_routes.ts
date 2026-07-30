// Admin-only CRUD surface for shop inventory (one row per tracked product).
// Every route is gated by requireAdmin (server/admin.ts, the SAME instance
// server/admin.ts's own routes mount): 'shop.read' for the reads, 'shop.manage'
// for the writes. The business rules stay in shop_inventory.ts (zero HTTP);
// this module owns the RouteDefs, the request-shape schemas, and the service
// singleton wired to Postgres.

import { pool } from './db';
import { adminOk } from './http/admin_envelope';
import { HttpError } from './http/errors';
import { withBody } from './http/middleware/body';
import {
  ADMIN_META,
  adminIdentityOf,
  adminTargetId,
  adminTargetMeta,
  requireAdminTarget,
} from './http/middleware/require_admin';
import { bool, enum_, type Infer, num, object, optional, str } from './http/schema';
import type { Ctx, RouteDef } from './http/types';
import { requireAdmin } from './admin';
import {
  type ShopInventoryErrorCode,
  ShopInventoryService,
  shopInventoryJson,
} from './shop_inventory';
import { PgShopInventoryDb } from './shop_inventory_db';
import { PgShopProductsDb } from './shop_products_db';

// ---------------------------------------------------------------------------
// The service singleton. Construction is pure (the Pg*Db classes only store
// the pool reference; no query runs until a request). The setter lets a unit
// test drive the routes with an in-memory fake (see maps_routes.ts).
// ---------------------------------------------------------------------------

const REAL_SHOP_INVENTORY_SERVICE = new ShopInventoryService(
  new PgShopInventoryDb(pool),
  new PgShopProductsDb(pool),
);
let inventoryServiceInstance: ShopInventoryService = REAL_SHOP_INVENTORY_SERVICE;

/** Override the shop inventory service with a fake (test-only). */
export function setShopInventoryServiceForTests(service: ShopInventoryService): void {
  inventoryServiceInstance = service;
}

/** Restore the real Postgres-backed shop inventory service (test-only). */
export function resetShopInventoryServiceForTests(): void {
  inventoryServiceInstance = REAL_SHOP_INVENTORY_SERVICE;
}

function inventoryService(): ShopInventoryService {
  return inventoryServiceInstance;
}

// ---------------------------------------------------------------------------
// Request-shape schemas.
// ---------------------------------------------------------------------------

const REASON_MAX_LEN = 500;
const inventorySortEnum = enum_(['quantity', 'updatedAt']);
const sortDirEnum = enum_(['asc', 'desc']);

const listInventoryQuerySchema = object({
  page: optional(num({ int: true, min: 1 }), 1),
  limit: optional(num({ int: true, min: 1, max: 100 }), 20),
  q: optional(str({ maxLength: 64 }), ''),
  lowStock: optional(bool(), false),
  sort: optional(inventorySortEnum, 'updatedAt'),
  dir: optional(sortDirEnum, 'desc'),
});

const createInventoryBodySchema = object({
  productId: num({ int: true, min: 1 }),
  quantityOnHand: optional(num({ int: true, min: 0 }), 0),
  lowStockThreshold: optional(num({ int: true, min: 0 }), 0),
  unlimited: optional(bool(), false),
  reason: optional(str({ maxLength: REASON_MAX_LEN }), ''),
});

const updateInventoryBodySchema = object({
  quantityOnHand: optional(num({ int: true, min: 0 })),
  lowStockThreshold: optional(num({ int: true, min: 0 })),
  unlimited: optional(bool()),
  reason: optional(str({ maxLength: REASON_MAX_LEN }), ''),
});

export type ListInventoryQuery = Infer<typeof listInventoryQuerySchema>;
export type CreateInventoryBody = Infer<typeof createInventoryBodySchema>;
export type UpdateInventoryBody = Infer<typeof updateInventoryBodySchema>;

/**
 * Map a domain-rule rejection to the shared shop HttpError codes (see
 * error_codes.ts). The admin envelope never spreads HttpError params into the
 * response body, so the specific ShopInventoryErrorCode reason
 * (already_tracked/invalid_quantity) is not sent to the client; every
 * remaining rejection maps to the one shared 400 code.
 */
function shopInventoryError(error: ShopInventoryErrorCode): HttpError {
  if (error === 'not_found' || error === 'product_not_found') {
    return new HttpError(404, 'shop.not_found');
  }
  return new HttpError(400, 'shop.invalid_input');
}

// ---------------------------------------------------------------------------
// Handlers.
// ---------------------------------------------------------------------------

/** GET /admin/api/shop/inventory: paginated, searchable, filterable, sortable list. */
async function listHandler(ctx: Ctx): Promise<void> {
  const decoded = listInventoryQuerySchema.decode(ctx.query);
  if (!decoded.ok) throw decoded;
  const { rows, total } = await inventoryService().listInventory(decoded.value);
  adminOk(ctx.res, {
    rows: rows.map(shopInventoryJson),
    total,
    page: decoded.value.page,
    limit: decoded.value.limit,
  });
}

/** POST /admin/api/shop/inventory: start tracking stock for a product. */
async function createHandler(ctx: Ctx): Promise<void> {
  const decoded = createInventoryBodySchema.decode(ctx.body ?? {});
  if (!decoded.ok) throw decoded;
  const adminAccountId = adminIdentityOf(ctx).accountId;
  const result = await inventoryService().createInventory(decoded.value, adminAccountId);
  if (!result.ok) throw shopInventoryError(result.error);
  adminOk(ctx.res, shopInventoryJson(result.inventory));
}

/** GET /admin/api/shop/inventory/:id: a single inventory row. */
async function getHandler(ctx: Ctx): Promise<void> {
  const inventory = await inventoryService().getInventory(adminTargetId(ctx));
  if (!inventory) throw new HttpError(404, 'shop.not_found');
  adminOk(ctx.res, shopInventoryJson(inventory));
}

/** POST /admin/api/shop/inventory/:id: adjust stock / thresholds / unlimited flag. */
async function updateHandler(ctx: Ctx): Promise<void> {
  const decoded = updateInventoryBodySchema.decode(ctx.body ?? {});
  if (!decoded.ok) throw decoded;
  const adminAccountId = adminIdentityOf(ctx).accountId;
  const result = await inventoryService().updateInventory(
    adminTargetId(ctx),
    decoded.value,
    adminAccountId,
  );
  if (!result.ok) throw shopInventoryError(result.error);
  adminOk(ctx.res, shopInventoryJson(result.inventory));
}

/** POST /admin/api/shop/inventory/:id/delete: stop tracking stock for a product. */
async function deleteHandler(ctx: Ctx): Promise<void> {
  const deleted = await inventoryService().deleteInventory(adminTargetId(ctx));
  if (!deleted) throw new HttpError(404, 'shop.not_found');
  adminOk(ctx.res, { ok: true });
}

// ---------------------------------------------------------------------------
// The route table. registry.ts spreads this into apiRoutes.
// ---------------------------------------------------------------------------

export const routes: RouteDef[] = [
  {
    method: 'GET',
    path: '/admin/api/shop/inventory',
    surface: 'admin',
    middleware: [requireAdmin],
    meta: ADMIN_META,
    handler: listHandler,
  },
  {
    method: 'POST',
    path: '/admin/api/shop/inventory',
    surface: 'admin',
    middleware: [requireAdmin, withBody()],
    meta: ADMIN_META,
    handler: createHandler,
  },
  {
    method: 'GET',
    path: '/admin/api/shop/inventory/:id',
    surface: 'admin',
    middleware: [requireAdmin, requireAdminTarget('shop_inventory')],
    meta: adminTargetMeta('shop_inventory'),
    handler: getHandler,
  },
  {
    // POST, not PUT: requireAdmin's central authorization gate
    // (server/http/middleware/require_admin.ts) only accepts GET/POST, like
    // every other admin-surface route.
    method: 'POST',
    path: '/admin/api/shop/inventory/:id',
    surface: 'admin',
    middleware: [requireAdmin, withBody(), requireAdminTarget('shop_inventory')],
    meta: adminTargetMeta('shop_inventory'),
    handler: updateHandler,
  },
  {
    // A literal /delete suffix, not the DELETE method (unsupported here), the
    // same shape as POST /admin/api/maps/:id/unpublish.
    method: 'POST',
    path: '/admin/api/shop/inventory/:id/delete',
    surface: 'admin',
    middleware: [requireAdmin, requireAdminTarget('shop_inventory')],
    meta: adminTargetMeta('shop_inventory'),
    handler: deleteHandler,
  },
];
