import type { AdminPermission } from './admin_permissions';

// Declarative permission map for every /admin/api route (login excepted: it is
// the one unauthenticated endpoint). handleAdminApi consults this table BEFORE
// its handler chain and fails closed: a route missing here can never execute.
// tests/admin_routes.test.ts scans server/admin.ts and fails if a handled path
// has no entry, so adding a route without deciding its permission is loud.
// 'any' means any authenticated staff account (used by /me only).

export type AdminRoutePermission = AdminPermission | 'any';

interface AdminRouteRule {
  method: 'GET' | 'POST';
  pattern: string | RegExp;
  permission: AdminRoutePermission;
}

export const ADMIN_ROUTE_PERMISSIONS: readonly AdminRouteRule[] = [
  { method: 'GET', pattern: '/admin/api/me', permission: 'any' },

  { method: 'GET', pattern: '/admin/api/overview', permission: 'analytics.read' },
  { method: 'GET', pattern: '/admin/api/provider-usage', permission: 'ops_usage.read' },
  { method: 'GET', pattern: '/admin/api/online', permission: 'accounts.read' },
  { method: 'GET', pattern: '/admin/api/online-history', permission: 'analytics.read' },
  { method: 'GET', pattern: '/admin/api/activity', permission: 'analytics.read' },
  { method: 'GET', pattern: '/admin/api/perf/summary', permission: 'analytics.read' },
  { method: 'GET', pattern: '/admin/api/perf/raw', permission: 'analytics.read' },
  // Server tick-loop profiling capture: ops-sensitive, admin/superadmin only.
  { method: 'GET', pattern: '/admin/api/perf/tick', permission: 'ops.perf' },
  { method: 'POST', pattern: '/admin/api/perf/tick/capture', permission: 'ops.perf' },
  { method: 'GET', pattern: '/admin/api/characters', permission: 'accounts.read' },

  { method: 'GET', pattern: '/admin/api/accounts', permission: 'accounts.read' },
  { method: 'GET', pattern: /^\/admin\/api\/accounts\/(\d+)$/, permission: 'accounts.read' },
  {
    method: 'GET',
    pattern: /^\/admin\/api\/accounts\/(\d+)\/daily-rewards-events$/,
    permission: 'accounts.read',
  },
  {
    method: 'POST',
    pattern: /^\/admin\/api\/accounts\/(\d+)\/reset-password$/,
    permission: 'accounts.password',
  },
  { method: 'GET', pattern: '/admin/api/shared-ips', permission: 'moderation.read' },
  { method: 'GET', pattern: '/admin/api/ip-associations', permission: 'accounts.read' },

  { method: 'GET', pattern: '/admin/api/moderation/queue', permission: 'moderation.read' },
  { method: 'GET', pattern: '/admin/api/moderation/history', permission: 'moderation.read' },
  {
    method: 'GET',
    pattern: /^\/admin\/api\/moderation\/accounts\/(\d+)$/,
    permission: 'moderation.read',
  },
  { method: 'GET', pattern: '/admin/api/chat-filter', permission: 'moderation.read' },
  { method: 'GET', pattern: '/admin/api/blocked-ips', permission: 'moderation.read' },

  { method: 'GET', pattern: '/admin/api/bug-reports', permission: 'support.read' },
  { method: 'GET', pattern: '/admin/api/unstuck-reports', permission: 'support.read' },
  {
    method: 'GET',
    pattern: /^\/admin\/api\/bug-reports\/(\d+)\/screenshot$/,
    permission: 'support.read',
  },

  { method: 'GET', pattern: '/admin/api/suspicious-players', permission: 'botdetector.read' },
  { method: 'GET', pattern: '/admin/api/detection-calibration', permission: 'botdetector.read' },
  { method: 'GET', pattern: '/admin/api/antibot-config', permission: 'botdetector.configure' },
  {
    method: 'GET',
    pattern: '/admin/api/antibot-config/history',
    permission: 'botdetector.configure',
  },
  { method: 'POST', pattern: '/admin/api/antibot-config', permission: 'botdetector.configure' },

  { method: 'GET', pattern: '/admin/api/maps', permission: 'content.moderate' },
  { method: 'GET', pattern: '/admin/api/user-assets', permission: 'content.moderate' },

  { method: 'GET', pattern: '/admin/api/staff', permission: 'staff.manage' },
  { method: 'GET', pattern: '/admin/api/staff/history', permission: 'staff.manage' },
  { method: 'POST', pattern: '/admin/api/staff/roles', permission: 'staff.manage' },

  {
    method: 'POST',
    pattern: /^\/admin\/api\/moderation\/accounts\/(\d+)\/(suspend|unsuspend|ban|unban)$/,
    permission: 'moderation.act',
  },
  {
    method: 'POST',
    pattern: /^\/admin\/api\/moderation\/accounts\/(\d+)\/reactivate$/,
    permission: 'moderation.act',
  },
  {
    method: 'POST',
    pattern: /^\/admin\/api\/moderation\/accounts\/(\d+)\/chat-mute$/,
    permission: 'moderation.act',
  },
  {
    method: 'POST',
    pattern: /^\/admin\/api\/moderation\/accounts\/(\d+)\/daily-rewards-(ban|unban)$/,
    permission: 'moderation.act',
  },
  {
    method: 'POST',
    pattern: /^\/admin\/api\/moderation\/accounts\/(\d+)\/daily-rewards-ip-(ban|unban)$/,
    permission: 'moderation.act',
  },
  {
    method: 'POST',
    pattern: /^\/admin\/api\/moderation\/accounts\/(\d+)\/lift-mute$/,
    permission: 'moderation.act',
  },
  {
    method: 'POST',
    pattern: /^\/admin\/api\/moderation\/accounts\/(\d+)\/note$/,
    permission: 'moderation.act',
  },
  {
    method: 'POST',
    pattern: /^\/admin\/api\/moderation\/accounts\/(\d+)\/reset-strikes$/,
    permission: 'moderation.act',
  },
  // Account flair (AI mark / streamer links). Not punitive, but they are
  // operator-only writes that every player can see, so they sit with the other
  // moderation actions rather than getting a permission of their own.
  {
    method: 'POST',
    pattern: /^\/admin\/api\/accounts\/(\d+)\/ai$/,
    permission: 'moderation.act',
  },
  {
    method: 'POST',
    pattern: /^\/admin\/api\/accounts\/(\d+)\/streamer$/,
    permission: 'moderation.act',
  },
  {
    method: 'POST',
    pattern: /^\/admin\/api\/moderation\/reports\/(\d+)\/ignore$/,
    permission: 'moderation.act',
  },
  {
    method: 'POST',
    pattern: /^\/admin\/api\/moderation\/characters\/(\d+)\/force-rename$/,
    permission: 'moderation.act',
  },

  { method: 'POST', pattern: '/admin/api/chat-filter/words', permission: 'chatfilter.manage' },
  {
    method: 'POST',
    pattern: /^\/admin\/api\/chat-filter\/words\/(\d+)\/delete$/,
    permission: 'chatfilter.manage',
  },
  { method: 'POST', pattern: '/admin/api/chat-filter/config', permission: 'chatfilter.manage' },

  { method: 'POST', pattern: '/admin/api/blocked-ips', permission: 'ipblocks.manage' },
  { method: 'POST', pattern: '/admin/api/blocked-ips/delete', permission: 'ipblocks.manage' },

  {
    method: 'POST',
    pattern: /^\/admin\/api\/maps\/(\d+)\/unpublish$/,
    permission: 'content.moderate',
  },
  {
    method: 'POST',
    pattern: /^\/admin\/api\/user-assets\/(\d+)\/(block|unblock)$/,
    permission: 'content.moderate',
  },

  // Shop catalog (categories/products/inventory): reads need shop.read,
  // writes need shop.manage. Registry-only RouteDefs (server/shop_categories_
  // routes.ts, shop_products_routes.ts, shop_inventory_routes.ts), same
  // new-route rule as the maps/user-assets rows above. GET and POST only:
  // requireAdmin's central authorization gate answers 405 for any other
  // method (server/http/middleware/require_admin.ts), so update is POST to
  // the plain :id path and delete is a literal POST .../:id/delete suffix,
  // the same shape as the /admin/api/maps/:id/unpublish row above.
  { method: 'GET', pattern: '/admin/api/shop/categories', permission: 'shop.read' },
  { method: 'POST', pattern: '/admin/api/shop/categories', permission: 'shop.manage' },
  {
    method: 'GET',
    pattern: /^\/admin\/api\/shop\/categories\/(\d+)$/,
    permission: 'shop.read',
  },
  {
    method: 'POST',
    pattern: /^\/admin\/api\/shop\/categories\/(\d+)$/,
    permission: 'shop.manage',
  },
  {
    method: 'POST',
    pattern: /^\/admin\/api\/shop\/categories\/(\d+)\/delete$/,
    permission: 'shop.manage',
  },

  { method: 'GET', pattern: '/admin/api/shop/products', permission: 'shop.read' },
  { method: 'POST', pattern: '/admin/api/shop/products', permission: 'shop.manage' },
  {
    method: 'GET',
    pattern: /^\/admin\/api\/shop\/products\/(\d+)$/,
    permission: 'shop.read',
  },
  {
    method: 'POST',
    pattern: /^\/admin\/api\/shop\/products\/(\d+)$/,
    permission: 'shop.manage',
  },
  {
    method: 'POST',
    pattern: /^\/admin\/api\/shop\/products\/(\d+)\/delete$/,
    permission: 'shop.manage',
  },

  { method: 'GET', pattern: '/admin/api/shop/inventory', permission: 'shop.read' },
  { method: 'POST', pattern: '/admin/api/shop/inventory', permission: 'shop.manage' },
  {
    method: 'GET',
    pattern: /^\/admin\/api\/shop\/inventory\/(\d+)$/,
    permission: 'shop.read',
  },
  {
    method: 'POST',
    pattern: /^\/admin\/api\/shop\/inventory\/(\d+)$/,
    permission: 'shop.manage',
  },
  {
    method: 'POST',
    pattern: /^\/admin\/api\/shop\/inventory\/(\d+)\/delete$/,
    permission: 'shop.manage',
  },

  { method: 'GET', pattern: '/admin/api/shop/orders', permission: 'shop.read' },
  { method: 'POST', pattern: '/admin/api/shop/orders', permission: 'shop.manage' },
  {
    method: 'GET',
    pattern: /^\/admin\/api\/shop\/orders\/(\d+)$/,
    permission: 'shop.read',
  },
  {
    method: 'POST',
    pattern: /^\/admin\/api\/shop\/orders\/(\d+)\/status$/,
    permission: 'shop.manage',
  },
  {
    method: 'POST',
    pattern: /^\/admin\/api\/shop\/orders\/(\d+)\/cancel$/,
    permission: 'shop.manage',
  },
  {
    method: 'POST',
    pattern: /^\/admin\/api\/shop\/orders\/(\d+)\/refund$/,
    permission: 'shop.manage',
  },

  // Claudium ledger (server/claudium_ledger_routes.ts): granting or
  // deducting an account's balance is a write on player currency, so it
  // needs shop.manage like every other shop write above, not the weaker
  // shop.read.
  {
    method: 'POST',
    pattern: /^\/admin\/api\/claudium\/accounts\/(\d+)\/adjust$/,
    permission: 'shop.manage',
  },

  // Claudium Packages (server/claudium_packages_routes.ts): the
  // admin-managed catalog of Claudium purchase tiers. Same GET/POST shape
  // as categories/products/inventory above.
  { method: 'GET', pattern: '/admin/api/shop/packages', permission: 'shop.read' },
  { method: 'POST', pattern: '/admin/api/shop/packages', permission: 'shop.manage' },
  {
    method: 'GET',
    pattern: /^\/admin\/api\/shop\/packages\/(\d+)$/,
    permission: 'shop.read',
  },
  {
    method: 'POST',
    pattern: /^\/admin\/api\/shop\/packages\/(\d+)$/,
    permission: 'shop.manage',
  },
  {
    method: 'POST',
    pattern: /^\/admin\/api\/shop\/packages\/(\d+)\/delete$/,
    permission: 'shop.manage',
  },

  // Claudium Package purchases (server/claudium_purchases_routes.ts):
  // the payment history / audit log. Read-only surface, same shop.read as
  // every other shop read above.
  { method: 'GET', pattern: '/admin/api/shop/claudium/purchases', permission: 'shop.read' },

  // Premium Shop purchase-announcement config (Phase 2D,
  // server/shop_announcement_config_routes.ts): the rarity-gated system-chat
  // + Discord webhook settings. Same shop.read/shop.manage split as every
  // other shop surface above; no :id, one document per realm.
  {
    method: 'GET',
    pattern: '/admin/api/shop/announcement-config',
    permission: 'shop.read',
  },
  {
    method: 'POST',
    pattern: '/admin/api/shop/announcement-config',
    permission: 'shop.manage',
  },
  {
    method: 'GET',
    pattern: '/admin/api/shop/announcement-config/history',
    permission: 'shop.read',
  },
];

function matches(pattern: string | RegExp, path: string): boolean {
  return typeof pattern === 'string' ? pattern === path : pattern.test(path);
}

export function permissionForAdminRoute(method: string, path: string): AdminRoutePermission | null {
  for (const rule of ADMIN_ROUTE_PERMISSIONS) {
    if (rule.method === method && matches(rule.pattern, path)) return rule.permission;
  }
  return null;
}

// True when the path is a known route under SOME method (drives 405 vs 404).
export function adminPathKnown(path: string): boolean {
  return ADMIN_ROUTE_PERMISSIONS.some((rule) => matches(rule.pattern, path));
}
