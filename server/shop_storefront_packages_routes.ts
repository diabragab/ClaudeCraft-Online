// Public (anonymous) read of the Claudium Packages catalog (Phase 7): what
// the in-game Store's Packages tab displays. A thin wrapper over the EXISTING
// ClaudiumPackagesService (the same class server/claudium_packages_routes.ts's
// admin surface uses); this module adds no business logic beyond forcing
// enabled: true server-side (never trusting a client-supplied filter), the
// same pattern server/shop_storefront_catalog_routes.ts uses for status.

import { ClaudiumPackagesService, claudiumPackageJson } from './claudium_packages';
import { PgClaudiumPackagesDb } from './claudium_packages_db';
import { pool } from './db';
import { enum_, num, object, optional, str } from './http/schema';
import type { Ctx, RouteDef } from './http/types';
import { json } from './http_util';
import { publicReadRateLimited } from './ratelimit';

const REAL_PACKAGES_SERVICE = new ClaudiumPackagesService(new PgClaudiumPackagesDb(pool));
let packagesService = REAL_PACKAGES_SERVICE;

export function setStorefrontPackagesServiceForTests(service: ClaudiumPackagesService): void {
  packagesService = service;
}

export function resetStorefrontPackagesServiceForTests(): void {
  packagesService = REAL_PACKAGES_SERVICE;
}

const packageSortEnum = enum_(['displayOrder', 'name', 'createdAt', 'updatedAt']);
const sortDirEnum = enum_(['asc', 'desc']);

const listPackagesQuerySchema = object({
  page: optional(num({ int: true, min: 1 }), 1),
  limit: optional(num({ int: true, min: 1, max: 100 }), 20),
  q: optional(str({ maxLength: 64 }), ''),
  sort: optional(packageSortEnum, 'displayOrder'),
  dir: optional(sortDirEnum, 'asc'),
});

function rateLimitOr429(ctx: Ctx): boolean {
  if (publicReadRateLimited(ctx.req).allowed) return true;
  json(ctx.res, 429, { error: 'rate limited', code: 'rate_limit.exceeded' });
  return false;
}

/** GET /api/shop/packages: paginated, searchable, sortable, enabled-only. */
async function listHandler(ctx: Ctx): Promise<void> {
  if (!rateLimitOr429(ctx)) return;
  const decoded = listPackagesQuerySchema.decode(ctx.query);
  if (!decoded.ok) throw decoded;
  const { rows, total } = await packagesService.listPackages({ ...decoded.value, enabled: true });
  json(ctx.res, 200, {
    rows: rows.map(claudiumPackageJson),
    total,
    page: decoded.value.page,
    limit: decoded.value.limit,
  });
}

export const routes: RouteDef[] = [
  {
    method: 'GET',
    path: '/api/shop/packages',
    surface: 'api',
    handler: listHandler,
  },
];
