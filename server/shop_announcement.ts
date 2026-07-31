// Premium Shop rarity-gated global announcement (Phase 2D): after a Claudium
// checkout delivers, optionally broadcast a server-wide system-chat line (and,
// if configured, POST it to a Discord webhook) celebrating an epic-or-above
// purchase. The decision/formatting half below is pure and I/O-free; the
// service class sequences the config read, the live-game broadcast, and the
// webhook POST, mirroring shop_delivery.ts's "sequence existing calls, no new
// business logic" shape.

import { RARITY_TIERS, type ShopRarity } from './shop_products';

// ---------------------------------------------------------------------------
// Config document (validated/defaulted here; persisted as opaque JSONB by
// shop_announcement_config_db.ts, the same split antibot_config_db.ts uses
// between storage and validation).
// ---------------------------------------------------------------------------

export interface ShopAnnouncementConfig {
  enabled: boolean;
  minRarity: ShopRarity;
  messageTemplate: string;
  discordWebhookEnabled: boolean;
  discordWebhookUrl: string;
}

export const DEFAULT_ANNOUNCEMENT_MESSAGE_TEMPLATE =
  '{player} just unlocked {item} ({rarity}) from the Premium Shop!';

export const DEFAULT_SHOP_ANNOUNCEMENT_CONFIG: ShopAnnouncementConfig = {
  enabled: true,
  minRarity: 'epic',
  messageTemplate: DEFAULT_ANNOUNCEMENT_MESSAGE_TEMPLATE,
  discordWebhookEnabled: false,
  discordWebhookUrl: '',
};

const RARITY_TIER_SET: ReadonlySet<string> = new Set(RARITY_TIERS);

/** Defaults every field independently, so a partial or malformed stored
 *  document (an old save, a hand-edited row) still produces a usable config
 *  instead of throwing. */
export function parseShopAnnouncementConfig(data: unknown): ShopAnnouncementConfig {
  const raw = typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {};
  const minRarity =
    typeof raw.minRarity === 'string' && RARITY_TIER_SET.has(raw.minRarity)
      ? (raw.minRarity as ShopRarity)
      : DEFAULT_SHOP_ANNOUNCEMENT_CONFIG.minRarity;
  const messageTemplate =
    typeof raw.messageTemplate === 'string' && raw.messageTemplate.trim().length > 0
      ? raw.messageTemplate
      : DEFAULT_SHOP_ANNOUNCEMENT_CONFIG.messageTemplate;
  return {
    enabled:
      typeof raw.enabled === 'boolean' ? raw.enabled : DEFAULT_SHOP_ANNOUNCEMENT_CONFIG.enabled,
    minRarity,
    messageTemplate,
    discordWebhookEnabled:
      typeof raw.discordWebhookEnabled === 'boolean'
        ? raw.discordWebhookEnabled
        : DEFAULT_SHOP_ANNOUNCEMENT_CONFIG.discordWebhookEnabled,
    discordWebhookUrl:
      typeof raw.discordWebhookUrl === 'string'
        ? raw.discordWebhookUrl
        : DEFAULT_SHOP_ANNOUNCEMENT_CONFIG.discordWebhookUrl,
  };
}

// ---------------------------------------------------------------------------
// Pure decision + formatting (zero I/O).
// ---------------------------------------------------------------------------

export interface ShopAnnouncementPurchase {
  playerName: string;
  productName: string;
  rarity: ShopRarity;
}

export interface ShopAnnouncementDecision {
  fire: boolean;
  message: string;
  postToDiscord: boolean;
}

const RARITY_RANK: Readonly<Record<ShopRarity, number>> = Object.fromEntries(
  RARITY_TIERS.map((tier, index) => [tier, index]),
) as Record<ShopRarity, number>;

/** Fills {player}/{item}/{rarity} in the template; any other brace token is
 *  left untouched (an admin typo shows literally rather than throwing). */
export function formatShopAnnouncement(
  template: string,
  purchase: ShopAnnouncementPurchase,
): string {
  return template
    .replaceAll('{player}', purchase.playerName)
    .replaceAll('{item}', purchase.productName)
    .replaceAll('{rarity}', purchase.rarity);
}

export function decideShopAnnouncement(
  config: ShopAnnouncementConfig,
  purchase: ShopAnnouncementPurchase,
): ShopAnnouncementDecision {
  if (!config.enabled || RARITY_RANK[purchase.rarity] < RARITY_RANK[config.minRarity]) {
    return { fire: false, message: '', postToDiscord: false };
  }
  return {
    fire: true,
    message: formatShopAnnouncement(config.messageTemplate, purchase),
    postToDiscord: config.discordWebhookEnabled && config.discordWebhookUrl.trim().length > 0,
  };
}

/** The system-chat color per rarity tier, matching the Armory/Store CSS
 *  --rarity custom-property palette (src/styles/components.css) so the
 *  in-chat announcement reads as the same tier the card itself shows. */
const RARITY_BROADCAST_COLOR: Readonly<Record<ShopRarity, string>> = {
  common: '#ffd100',
  uncommon: '#1eff00',
  rare: '#2f8dff',
  epic: '#a335ee',
  legendary: '#ff8000',
  mythic: '#ff2d6b',
};

export function shopAnnouncementColor(rarity: ShopRarity): string {
  return RARITY_BROADCAST_COLOR[rarity];
}

// ---------------------------------------------------------------------------
// Config read seam: constructor-injected (not the module-singleton pattern
// below) because, unlike reaching live GameServer, reading this table has no
// import-cycle problem, and injection lets shop_announcement.test.ts drive it
// with a FakeDb instead of Postgres.
// ---------------------------------------------------------------------------

export interface ShopAnnouncementConfigReader {
  loadConfig(): Promise<{ data: unknown }>;
}

// ---------------------------------------------------------------------------
// Live-game runtime hook, injected from server/main.ts
// (configureShopAnnouncementRuntime). GameServer.broadcastSystem is private,
// and shop_announcement.ts cannot import GameServer directly without an
// import cycle (server/game.ts already pulls in the checkout stack this
// module is called from), so this mirrors shop_delivery.ts's
// configureShopDeliveryRuntime seam exactly.
// ---------------------------------------------------------------------------

export interface ShopAnnouncementRuntimeHooks {
  broadcastSystem(text: string, color: string): void;
}
let announcementRuntime: ShopAnnouncementRuntimeHooks | null = null;

export function configureShopAnnouncementRuntime(rt: ShopAnnouncementRuntimeHooks): void {
  announcementRuntime = rt;
}

/** Test-only: drop the injected runtime hook between test files. */
export function resetShopAnnouncementRuntimeForTests(): void {
  announcementRuntime = null;
}

const DISCORD_WEBHOOK_TIMEOUT_MS = 5000;

export interface DiscordWebhookPostResult {
  ok: boolean;
  status: number | null;
  error: string | null;
}

/** Bounded-timeout POST that reports its outcome, used both by the
 *  fire-and-forget purchase announcement below and by the admin panel's
 *  "send test message" action (server/shop_announcement_config_routes.ts),
 *  which needs the real result to show the operator. */
export async function postDiscordWebhookForTest(
  url: string,
  content: string,
): Promise<DiscordWebhookPostResult> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
      signal: AbortSignal.timeout(DISCORD_WEBHOOK_TIMEOUT_MS),
    });
    return { ok: res.ok, status: res.status, error: res.ok ? null : `HTTP ${res.status}` };
  } catch (err) {
    return {
      ok: false,
      status: null,
      error: err instanceof Error ? err.message : 'request failed',
    };
  }
}

/** Fire-and-forget: every failure is swallowed here so a broken or
 *  rate-limited webhook can never surface to the buyer. */
async function postDiscordWebhook(url: string, content: string): Promise<void> {
  const result = await postDiscordWebhookForTest(url, content);
  if (!result.ok) console.error('shop announcement discord webhook failed:', result.error);
}

export class ShopAnnouncementService {
  constructor(private readonly configDb: ShopAnnouncementConfigReader) {}

  /**
   * Best-effort: called right after deliverShopProduct in
   * ShopLedgerCheckoutService.purchase(), mirroring
   * maybeBroadcastDeedUnlock's error-swallowed shape (server/game.ts). The
   * checkout has already succeeded and responded by the time this runs; an
   * announcement failure must never surface to the buyer or retry the charge.
   */
  async announcePurchase(purchase: ShopAnnouncementPurchase): Promise<void> {
    try {
      const stored = await this.configDb.loadConfig();
      const config = parseShopAnnouncementConfig(stored.data);
      const decision = decideShopAnnouncement(config, purchase);
      if (!decision.fire) return;
      announcementRuntime?.broadcastSystem(
        decision.message,
        shopAnnouncementColor(purchase.rarity),
      );
      if (decision.postToDiscord) {
        await postDiscordWebhook(config.discordWebhookUrl, decision.message);
      }
    } catch (err) {
      console.error('shop announcement failed:', err);
    }
  }
}
