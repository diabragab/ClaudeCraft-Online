// Shared success-envelope writer for /admin/api RouteDef handlers that live
// outside server/admin.ts (the shop catalog family: shop_categories_routes.ts,
// shop_products_routes.ts, shop_inventory_routes.ts). Every admin-surface route
// answers { success, data, error }, never problem+json (server/http/types.ts
// Surface 'admin'). The ERROR half of that envelope is already produced by the
// shared 'admin' envelope serializer (server/http/errors.ts serializeAdmin)
// whenever a handler throws HttpError, so this helper only covers the success
// half, matching the same-shaped `ok()` helper server/admin.ts keeps local to
// itself.

import type * as http from 'node:http';
import { json } from '../http_util';

/** Write a 200 { success: true, data, error: null } admin-envelope response. */
export function adminOk(res: http.ServerResponse, data: unknown): void {
  json(res, 200, { success: true, data, error: null });
}
