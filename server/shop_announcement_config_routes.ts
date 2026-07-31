// Admin-only surface for the Premium Shop's rarity-gated purchase-announcement
// config (Phase 2D/2E): the JSONB document shop_announcement.ts reads on every
// checkout. Registry-only (no legacy ladder twin, a brand-new admin surface),
// gated by requireAdmin the same way shop_products_routes.ts is: 'shop.read'
// for the read, 'shop.manage' for the write.

import { requireAdmin } from './admin';
import { adminOk } from './http/admin_envelope';
import { HttpError } from './http/errors';
import { withBody } from './http/middleware/body';
import { ADMIN_META, adminIdentityOf } from './http/middleware/require_admin';
import { bool, enum_, type Infer, object, optional, str } from './http/schema';
import type { Ctx, RouteDef } from './http/types';
import {
  DEFAULT_SHOP_ANNOUNCEMENT_CONFIG,
  parseShopAnnouncementConfig,
  postDiscordWebhookForTest,
  type ShopAnnouncementConfig,
} from './shop_announcement';
import {
  listShopAnnouncementConfigHistory,
  loadShopAnnouncementConfig,
  saveShopAnnouncementConfigChange,
} from './shop_announcement_config_db';
import { RARITY_TIERS } from './shop_products';

const NOTE_MAX = 300;
const rarityEnum = enum_(RARITY_TIERS);

const TEST_MESSAGE_URL_MAX = 300;
const testDiscordBodySchema = object({
  url: optional(str({ maxLength: TEST_MESSAGE_URL_MAX })),
});

// A generic placeholder trio so the operator sees the SAME formatting a real
// purchase would produce, without needing a live sale to test the webhook.
const TEST_MESSAGE = 'This is a test announcement from the World of ClaudeCraft admin panel.';

const saveConfigBodySchema = object({
  enabled: optional(bool(), DEFAULT_SHOP_ANNOUNCEMENT_CONFIG.enabled),
  minRarity: optional(rarityEnum, DEFAULT_SHOP_ANNOUNCEMENT_CONFIG.minRarity),
  messageTemplate: optional(
    str({ minLength: 1, maxLength: 300 }),
    DEFAULT_SHOP_ANNOUNCEMENT_CONFIG.messageTemplate,
  ),
  discordWebhookEnabled: optional(bool(), DEFAULT_SHOP_ANNOUNCEMENT_CONFIG.discordWebhookEnabled),
  discordWebhookUrl: optional(
    str({ maxLength: 300 }),
    DEFAULT_SHOP_ANNOUNCEMENT_CONFIG.discordWebhookUrl,
  ),
  note: optional(str({ maxLength: NOTE_MAX }), ''),
});

export type SaveConfigBody = Infer<typeof saveConfigBodySchema>;

function configJson(config: ShopAnnouncementConfig, updatedAt: string | null) {
  return { config, updatedAt };
}

/** GET /admin/api/shop/announcement-config: the effective (defaulted) config. */
async function getHandler(ctx: Ctx): Promise<void> {
  const stored = await loadShopAnnouncementConfig();
  adminOk(ctx.res, configJson(parseShopAnnouncementConfig(stored.data), stored.updatedAt));
}

/** GET /admin/api/shop/announcement-config/history: the append-only audit trail. */
async function historyHandler(ctx: Ctx): Promise<void> {
  adminOk(ctx.res, { entries: await listShopAnnouncementConfigHistory() });
}

/** POST /admin/api/shop/announcement-config: validate-then-save; a no-op save
 *  (identical document) leaves updatedAt and the audit trail untouched. */
async function saveHandler(ctx: Ctx): Promise<void> {
  const decoded = saveConfigBodySchema.decode(ctx.body ?? {});
  if (!decoded.ok) throw decoded;
  const { note, ...fields } = decoded.value;
  const saved = await saveShopAnnouncementConfigChange(
    fields,
    adminIdentityOf(ctx).accountId,
    note,
  );
  adminOk(ctx.res, configJson(parseShopAnnouncementConfig(fields), saved.updatedAt));
}

/** POST /admin/api/shop/announcement-config/test-discord: fires one test
 *  message at either the given URL or, when omitted, the currently saved
 *  webhook URL, and reports the real HTTP outcome (unlike the fire-and-forget
 *  production path, an operator needs to see whether it actually worked). */
async function testDiscordHandler(ctx: Ctx): Promise<void> {
  const decoded = testDiscordBodySchema.decode(ctx.body ?? {});
  if (!decoded.ok) throw decoded;
  let url = decoded.value.url?.trim();
  if (!url) {
    const stored = await loadShopAnnouncementConfig();
    url = parseShopAnnouncementConfig(stored.data).discordWebhookUrl.trim();
  }
  if (!url) throw new HttpError(400, 'shop.invalid_input');
  adminOk(ctx.res, await postDiscordWebhookForTest(url, TEST_MESSAGE));
}

export const routes: RouteDef[] = [
  {
    method: 'GET',
    path: '/admin/api/shop/announcement-config',
    surface: 'admin',
    middleware: [requireAdmin],
    meta: ADMIN_META,
    handler: getHandler,
  },
  {
    method: 'POST',
    path: '/admin/api/shop/announcement-config',
    surface: 'admin',
    middleware: [requireAdmin, withBody()],
    meta: ADMIN_META,
    handler: saveHandler,
  },
  {
    method: 'GET',
    path: '/admin/api/shop/announcement-config/history',
    surface: 'admin',
    middleware: [requireAdmin],
    meta: ADMIN_META,
    handler: historyHandler,
  },
  {
    method: 'POST',
    path: '/admin/api/shop/announcement-config/test-discord',
    surface: 'admin',
    middleware: [requireAdmin, withBody()],
    meta: ADMIN_META,
    handler: testDiscordHandler,
  },
];
