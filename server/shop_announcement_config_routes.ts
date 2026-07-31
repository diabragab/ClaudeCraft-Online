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
  isAllowedDiscordWebhookUrl,
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

// Every config field is genuinely optional here (no schema-level default):
// saveHandler merges the decoded patch onto the CURRENTLY STORED document
// rather than defaulting an omitted field to its catalog default, so a save
// that only changes one field (e.g. { enabled: false }) can never silently
// reset every other field an operator already configured.
const saveConfigBodySchema = object({
  enabled: optional(bool()),
  minRarity: optional(rarityEnum),
  messageTemplate: optional(str({ minLength: 1, maxLength: 300 })),
  discordWebhookEnabled: optional(bool()),
  discordWebhookUrl: optional(str({ maxLength: 300 })),
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

/** POST /admin/api/shop/announcement-config: validate, MERGE onto the
 *  currently stored document (never onto catalog defaults, so an omitted
 *  field keeps its existing value), then save; a no-op save (identical
 *  document) leaves updatedAt and the audit trail untouched. */
async function saveHandler(ctx: Ctx): Promise<void> {
  const decoded = saveConfigBodySchema.decode(ctx.body ?? {});
  if (!decoded.ok) throw decoded;
  const { note, ...patch } = decoded.value;
  const stored = await loadShopAnnouncementConfig();
  const current = parseShopAnnouncementConfig(stored.data);
  const merged: ShopAnnouncementConfig = {
    enabled: patch.enabled ?? current.enabled,
    minRarity: patch.minRarity ?? current.minRarity,
    messageTemplate: patch.messageTemplate ?? current.messageTemplate,
    discordWebhookEnabled: patch.discordWebhookEnabled ?? current.discordWebhookEnabled,
    discordWebhookUrl: patch.discordWebhookUrl ?? current.discordWebhookUrl,
  };
  const trimmedUrl = merged.discordWebhookUrl.trim();
  if (trimmedUrl !== '' && !isAllowedDiscordWebhookUrl(trimmedUrl)) {
    throw new HttpError(422, 'shop.invalid_input');
  }
  const saved = await saveShopAnnouncementConfigChange(
    { ...merged },
    adminIdentityOf(ctx).accountId,
    note,
  );
  adminOk(ctx.res, configJson(merged, saved.updatedAt));
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
