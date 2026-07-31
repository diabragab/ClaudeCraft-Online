import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  configureShopAnnouncementRuntime,
  DEFAULT_SHOP_ANNOUNCEMENT_CONFIG,
  decideShopAnnouncement,
  formatShopAnnouncement,
  parseShopAnnouncementConfig,
  resetShopAnnouncementRuntimeForTests,
  type ShopAnnouncementConfig,
  type ShopAnnouncementConfigReader,
  ShopAnnouncementService,
  shopAnnouncementColor,
} from '../../server/shop_announcement';

const PURCHASE = { playerName: 'Aria', productName: 'Cinderbrand Sword', rarity: 'epic' as const };

describe('parseShopAnnouncementConfig', () => {
  it('returns the defaults for an empty/missing document', () => {
    expect(parseShopAnnouncementConfig({})).toEqual(DEFAULT_SHOP_ANNOUNCEMENT_CONFIG);
    expect(parseShopAnnouncementConfig(null)).toEqual(DEFAULT_SHOP_ANNOUNCEMENT_CONFIG);
    expect(parseShopAnnouncementConfig(undefined)).toEqual(DEFAULT_SHOP_ANNOUNCEMENT_CONFIG);
  });

  it('reads every field independently from a full document', () => {
    const doc = {
      enabled: false,
      minRarity: 'mythic',
      messageTemplate: '{player} got {item}!',
      discordWebhookEnabled: true,
      discordWebhookUrl: 'https://discord.com/api/webhooks/x/y',
    };
    expect(parseShopAnnouncementConfig(doc)).toEqual(doc);
  });

  it('falls back per-field on an unknown rarity or a blank template, not the whole document', () => {
    const parsed = parseShopAnnouncementConfig({
      minRarity: 'not-a-tier',
      messageTemplate: '   ',
      enabled: false,
    });
    expect(parsed.minRarity).toBe(DEFAULT_SHOP_ANNOUNCEMENT_CONFIG.minRarity);
    expect(parsed.messageTemplate).toBe(DEFAULT_SHOP_ANNOUNCEMENT_CONFIG.messageTemplate);
    expect(parsed.enabled).toBe(false);
  });
});

describe('formatShopAnnouncement', () => {
  it('fills player/item/rarity placeholders', () => {
    expect(formatShopAnnouncement('{player} unlocked {item} ({rarity})!', PURCHASE)).toBe(
      'Aria unlocked Cinderbrand Sword (epic)!',
    );
  });

  it('leaves an unrecognized placeholder untouched', () => {
    expect(formatShopAnnouncement('{player} got {item} at {time}', PURCHASE)).toBe(
      'Aria got Cinderbrand Sword at {time}',
    );
  });
});

describe('decideShopAnnouncement', () => {
  const config: ShopAnnouncementConfig = {
    ...DEFAULT_SHOP_ANNOUNCEMENT_CONFIG,
    minRarity: 'epic',
  };

  it('fires for a purchase at exactly the minimum rarity', () => {
    const decision = decideShopAnnouncement(config, PURCHASE);
    expect(decision.fire).toBe(true);
    expect(decision.message).toContain('Cinderbrand Sword');
  });

  it('fires for a purchase above the minimum rarity', () => {
    const decision = decideShopAnnouncement(config, { ...PURCHASE, rarity: 'mythic' });
    expect(decision.fire).toBe(true);
  });

  it('does not fire below the minimum rarity', () => {
    const decision = decideShopAnnouncement(config, { ...PURCHASE, rarity: 'rare' });
    expect(decision).toEqual({ fire: false, message: '', postToDiscord: false });
  });

  it('does not fire when disabled, regardless of rarity', () => {
    const decision = decideShopAnnouncement(
      { ...config, enabled: false },
      { ...PURCHASE, rarity: 'mythic' },
    );
    expect(decision.fire).toBe(false);
  });

  it('only requests a Discord post when the webhook is enabled AND a URL is set', () => {
    const noUrl = decideShopAnnouncement(
      { ...config, discordWebhookEnabled: true, discordWebhookUrl: '' },
      PURCHASE,
    );
    expect(noUrl.postToDiscord).toBe(false);

    const disabled = decideShopAnnouncement(
      { ...config, discordWebhookEnabled: false, discordWebhookUrl: 'https://discord.com/x' },
      PURCHASE,
    );
    expect(disabled.postToDiscord).toBe(false);

    const ready = decideShopAnnouncement(
      { ...config, discordWebhookEnabled: true, discordWebhookUrl: 'https://discord.com/x' },
      PURCHASE,
    );
    expect(ready.postToDiscord).toBe(true);
  });
});

describe('shopAnnouncementColor', () => {
  it('gives every rarity tier its own color', () => {
    const colors = new Set(
      (['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'] as const).map(
        shopAnnouncementColor,
      ),
    );
    expect(colors.size).toBe(6);
  });
});

class FakeConfigReader implements ShopAnnouncementConfigReader {
  data: unknown = {};
  async loadConfig(): Promise<{ data: unknown }> {
    return { data: this.data };
  }
}

describe('ShopAnnouncementService.announcePurchase', () => {
  let broadcastSystem: ReturnType<typeof vi.fn>;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    broadcastSystem = vi.fn();
    configureShopAnnouncementRuntime({
      broadcastSystem: broadcastSystem as (text: string, color: string) => void,
    });
    fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    resetShopAnnouncementRuntimeForTests();
    vi.unstubAllGlobals();
  });

  it('broadcasts the formatted message with the rarity color on a qualifying purchase', async () => {
    const reader = new FakeConfigReader();
    reader.data = { enabled: true, minRarity: 'epic' };
    const svc = new ShopAnnouncementService(reader);

    await svc.announcePurchase(PURCHASE);

    expect(broadcastSystem).toHaveBeenCalledWith(
      'Aria just unlocked Cinderbrand Sword (epic) from the Premium Shop!',
      shopAnnouncementColor('epic'),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not broadcast a below-threshold purchase', async () => {
    const reader = new FakeConfigReader();
    reader.data = { enabled: true, minRarity: 'legendary' };
    const svc = new ShopAnnouncementService(reader);

    await svc.announcePurchase(PURCHASE);

    expect(broadcastSystem).not.toHaveBeenCalled();
  });

  it('posts to the configured Discord webhook when enabled', async () => {
    const reader = new FakeConfigReader();
    reader.data = {
      enabled: true,
      minRarity: 'epic',
      discordWebhookEnabled: true,
      discordWebhookUrl: 'https://discord.com/api/webhooks/1/token',
    };
    const svc = new ShopAnnouncementService(reader);

    await svc.announcePurchase(PURCHASE);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://discord.com/api/webhooks/1/token');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      content: 'Aria just unlocked Cinderbrand Sword (epic) from the Premium Shop!',
    });
  });

  it('swallows a config-load failure without throwing', async () => {
    const reader: ShopAnnouncementConfigReader = {
      loadConfig: async () => {
        throw new Error('db down');
      },
    };
    const svc = new ShopAnnouncementService(reader);
    await expect(svc.announcePurchase(PURCHASE)).resolves.toBeUndefined();
    expect(broadcastSystem).not.toHaveBeenCalled();
  });

  it('swallows a Discord webhook failure without throwing', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    const reader = new FakeConfigReader();
    reader.data = {
      enabled: true,
      minRarity: 'epic',
      discordWebhookEnabled: true,
      discordWebhookUrl: 'https://discord.com/api/webhooks/1/token',
    };
    const svc = new ShopAnnouncementService(reader);

    await expect(svc.announcePurchase(PURCHASE)).resolves.toBeUndefined();
    expect(broadcastSystem).toHaveBeenCalledTimes(1);
  });

  it('no-ops silently when no runtime hook has been configured', async () => {
    resetShopAnnouncementRuntimeForTests();
    const reader = new FakeConfigReader();
    reader.data = { enabled: true, minRarity: 'epic' };
    const svc = new ShopAnnouncementService(reader);
    await expect(svc.announcePurchase(PURCHASE)).resolves.toBeUndefined();
  });
});
