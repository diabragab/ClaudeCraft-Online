// Admin-only CRUD surface for Claudium Packages (Phase 7). Every route is
// gated by requireAdmin (server/admin.ts): 'shop.read' for the reads,
// 'shop.manage' for the writes (server/admin_routes.ts's declarative map).
// The business rules stay in claudium_packages.ts (zero HTTP); this module
// owns the RouteDefs, the request-shape schemas, and the service singleton
// wired to Postgres, mirroring server/shop_products_routes.ts exactly.

import { requireAdmin } from './admin';
import {
  type ClaudiumPackageErrorCode,
  ClaudiumPackagesService,
  claudiumPackageJson,
} from './claudium_packages';
import { PgClaudiumPackagesDb } from './claudium_packages_db';
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

// ---------------------------------------------------------------------------
// The service singleton. The setter lets a unit test drive the routes with
// an in-memory fake (see shop_products_routes.ts).
// ---------------------------------------------------------------------------

const REAL_PACKAGES_SERVICE = new ClaudiumPackagesService(new PgClaudiumPackagesDb(pool));
let packagesServiceInstance = REAL_PACKAGES_SERVICE;

export function setClaudiumPackagesServiceForTests(service: ClaudiumPackagesService): void {
  packagesServiceInstance = service;
}

export function resetClaudiumPackagesServiceForTests(): void {
  packagesServiceInstance = REAL_PACKAGES_SERVICE;
}

function packagesService(): ClaudiumPackagesService {
  return packagesServiceInstance;
}

// ---------------------------------------------------------------------------
// Request-shape schemas.
// ---------------------------------------------------------------------------

const packageSortEnum = enum_(['displayOrder', 'name', 'createdAt', 'updatedAt']);
const sortDirEnum = enum_(['asc', 'desc']);

const listPackagesQuerySchema = object({
  page: optional(num({ int: true, min: 1 }), 1),
  limit: optional(num({ int: true, min: 1, max: 100 }), 20),
  q: optional(str({ maxLength: 64 }), ''),
  enabled: optional(bool()),
  featured: optional(bool()),
  sort: optional(packageSortEnum, 'displayOrder'),
  dir: optional(sortDirEnum, 'asc'),
});

const createPackageBodySchema = object({
  name: str({ minLength: 1, maxLength: 120 }),
  claudiumAmount: num({ int: true, min: 1 }),
  bonusAmount: optional(num({ int: true, min: 0 }), 0),
  price: num({ int: true, min: 0 }),
  currency: optional(str({ minLength: 3, maxLength: 8 }), 'USD'),
  stripePriceId: optional(str({ maxLength: 120 }), ''),
  enabled: optional(bool(), true),
  displayOrder: optional(num({ int: true, min: 0 }), 0),
  imageUrl: optional(str({ maxLength: 500 }), ''),
  discountPercent: optional(num({ int: true, min: 0, max: 100 }), 0),
  featured: optional(bool(), false),
});

const updatePackageBodySchema = object({
  name: optional(str({ minLength: 1, maxLength: 120 })),
  claudiumAmount: optional(num({ int: true, min: 1 })),
  bonusAmount: optional(num({ int: true, min: 0 })),
  price: optional(num({ int: true, min: 0 })),
  currency: optional(str({ minLength: 3, maxLength: 8 })),
  stripePriceId: optional(str({ maxLength: 120 })),
  enabled: optional(bool()),
  displayOrder: optional(num({ int: true, min: 0 })),
  imageUrl: optional(str({ maxLength: 500 })),
  discountPercent: optional(num({ int: true, min: 0, max: 100 })),
  featured: optional(bool()),
});

export type ListPackagesQuery = Infer<typeof listPackagesQuerySchema>;
export type CreatePackageBody = Infer<typeof createPackageBodySchema>;
export type UpdatePackageBody = Infer<typeof updatePackageBodySchema>;

function claudiumPackageError(error: ClaudiumPackageErrorCode): HttpError {
  if (error === 'not_found') return new HttpError(404, 'shop.not_found');
  return new HttpError(400, 'shop.invalid_input');
}

// ---------------------------------------------------------------------------
// Handlers.
// ---------------------------------------------------------------------------

/** GET /admin/api/shop/packages: paginated, searchable, sortable list. */
async function listHandler(ctx: Ctx): Promise<void> {
  const decoded = listPackagesQuerySchema.decode(ctx.query);
  if (!decoded.ok) throw decoded;
  const { rows, total } = await packagesService().listPackages(decoded.value);
  adminOk(ctx.res, {
    rows: rows.map(claudiumPackageJson),
    total,
    page: decoded.value.page,
    limit: decoded.value.limit,
  });
}

/** POST /admin/api/shop/packages: create a package. */
async function createHandler(ctx: Ctx): Promise<void> {
  const decoded = createPackageBodySchema.decode(ctx.body ?? {});
  if (!decoded.ok) throw decoded;
  const result = await packagesService().createPackage(decoded.value);
  if (!result.ok) throw claudiumPackageError(result.error);
  adminOk(ctx.res, claudiumPackageJson(result.pkg));
}

/** GET /admin/api/shop/packages/:id: a single package. */
async function getHandler(ctx: Ctx): Promise<void> {
  const pkg = await packagesService().getPackage(adminTargetId(ctx));
  if (!pkg) throw new HttpError(404, 'shop.not_found');
  adminOk(ctx.res, claudiumPackageJson(pkg));
}

/** POST /admin/api/shop/packages/:id: partial update. */
async function updateHandler(ctx: Ctx): Promise<void> {
  const decoded = updatePackageBodySchema.decode(ctx.body ?? {});
  if (!decoded.ok) throw decoded;
  const result = await packagesService().updatePackage(adminTargetId(ctx), decoded.value);
  if (!result.ok) throw claudiumPackageError(result.error);
  adminOk(ctx.res, claudiumPackageJson(result.pkg));
}

/** POST /admin/api/shop/packages/:id/delete: delete a package. */
async function deleteHandler(ctx: Ctx): Promise<void> {
  const deleted = await packagesService().deletePackage(adminTargetId(ctx));
  if (!deleted) throw new HttpError(404, 'shop.not_found');
  adminOk(ctx.res, { ok: true });
}

// ---------------------------------------------------------------------------
// The route table. registry.ts spreads this into apiRoutes.
// ---------------------------------------------------------------------------

export const routes: RouteDef[] = [
  {
    method: 'GET',
    path: '/admin/api/shop/packages',
    surface: 'admin',
    middleware: [requireAdmin],
    meta: ADMIN_META,
    handler: listHandler,
  },
  {
    method: 'POST',
    path: '/admin/api/shop/packages',
    surface: 'admin',
    middleware: [requireAdmin, withBody()],
    meta: ADMIN_META,
    handler: createHandler,
  },
  {
    method: 'GET',
    path: '/admin/api/shop/packages/:id',
    surface: 'admin',
    middleware: [requireAdmin, requireAdminTarget('claudium_package')],
    meta: adminTargetMeta('claudium_package'),
    handler: getHandler,
  },
  {
    method: 'POST',
    path: '/admin/api/shop/packages/:id',
    surface: 'admin',
    middleware: [requireAdmin, withBody(), requireAdminTarget('claudium_package')],
    meta: adminTargetMeta('claudium_package'),
    handler: updateHandler,
  },
  {
    method: 'POST',
    path: '/admin/api/shop/packages/:id/delete',
    surface: 'admin',
    middleware: [requireAdmin, requireAdminTarget('claudium_package')],
    meta: adminTargetMeta('claudium_package'),
    handler: deleteHandler,
  },
];
