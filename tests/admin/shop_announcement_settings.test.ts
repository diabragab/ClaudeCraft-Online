// @vitest-environment jsdom
import './_setup';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const CONFIG_DATA = {
  config: {
    enabled: true,
    minRarity: 'epic' as const,
    messageTemplate: '{player} unlocked {item} ({rarity})!',
    discordWebhookEnabled: false,
    discordWebhookUrl: '',
  },
  updatedAt: '2026-01-01T00:00:00Z',
};
const HISTORY_DATA = {
  entries: [
    {
      id: 1,
      beforeData: {},
      afterData: { enabled: true, minRarity: 'legendary' as const },
      note: 'initial setup',
      createdAt: '2026-01-01T00:00:00Z',
      adminAccountId: 1,
      adminUsername: 'op',
    },
  ],
};

const apiGet = vi.fn(async (path: string) => {
  if (path.includes('/history')) return HISTORY_DATA;
  return CONFIG_DATA;
});
const apiPost = vi.fn();
vi.mock('../../src/admin/api', () => ({
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
  apiGet: (...a: unknown[]) => apiGet(...(a as [string])),
  apiPost: (...a: unknown[]) => apiPost(...a),
  getToken: () => 'tok',
  getAdminName: () => 'admin',
  clearSession: () => {},
}));

import { t } from '../../src/admin/i18n';
import ShopAnnouncementSettings from '../../src/admin/pages/ShopAnnouncementSettings.svelte';
import { grantPermissions } from './_grant';

beforeEach(() => {
  apiGet.mockClear();
  apiPost.mockReset();
  apiPost.mockResolvedValue(CONFIG_DATA);
  grantPermissions();
});

describe('ShopAnnouncementSettings', () => {
  it('loads and renders the saved config, including the live preview', async () => {
    render(ShopAnnouncementSettings);
    const template = (await screen.findByLabelText(
      t('shopAnnouncements.messageTemplateLabel'),
    )) as HTMLTextAreaElement;
    expect(template.value).toBe('{player} unlocked {item} ({rarity})!');
    expect(await screen.findByText('Aria unlocked Cinderbrand Sword (epic)!')).toBeInTheDocument();
  });

  it('saves the edited config with a change note', async () => {
    render(ShopAnnouncementSettings);
    const template = (await screen.findByLabelText(
      t('shopAnnouncements.messageTemplateLabel'),
    )) as HTMLTextAreaElement;
    await fireEvent.input(template, { target: { value: '{player} snagged {item}!' } });
    await fireEvent.input(
      screen.getByPlaceholderText(t('shopAnnouncements.changeNotePlaceholder')),
      { target: { value: 'tightened wording' } },
    );
    await fireEvent.click(screen.getByRole('button', { name: t('shopCommon.save') }));

    expect(apiPost).toHaveBeenCalledWith('/admin/api/shop/announcement-config', {
      enabled: true,
      minRarity: 'epic',
      messageTemplate: '{player} snagged {item}!',
      discordWebhookEnabled: false,
      discordWebhookUrl: '',
      note: 'tightened wording',
    });
  });

  it('sends a Discord test message using the entered URL', async () => {
    apiPost.mockResolvedValueOnce({ ok: true, status: 204, error: null });
    render(ShopAnnouncementSettings);
    await screen.findByLabelText(t('shopAnnouncements.messageTemplateLabel'));
    await fireEvent.click(screen.getByLabelText(t('shopAnnouncements.discordEnabledLabel')));
    await fireEvent.input(screen.getByLabelText(t('shopAnnouncements.discordUrlLabel')), {
      target: { value: 'https://discord.com/api/webhooks/1/token' },
    });
    await fireEvent.click(screen.getByRole('button', { name: t('shopAnnouncements.sendTest') }));

    expect(apiPost).toHaveBeenCalledWith('/admin/api/shop/announcement-config/test-discord', {
      url: 'https://discord.com/api/webhooks/1/token',
    });
    expect(await screen.findByText(t('shopAnnouncements.testSucceeded'))).toBeInTheDocument();
  });

  it('renders the change history and restores a prior version', async () => {
    render(ShopAnnouncementSettings);
    await screen.findByText('op');
    await fireEvent.click(screen.getByRole('button', { name: t('shopAnnouncements.restore') }));
    const minRarity = screen.getByLabelText(
      t('shopAnnouncements.minRarityLabel'),
    ) as HTMLSelectElement;
    expect(minRarity.value).toBe('legendary');
  });

  it('disables every control and hides save without shop.manage', async () => {
    grantPermissions(['shop.read']);
    render(ShopAnnouncementSettings);
    const template = (await screen.findByLabelText(
      t('shopAnnouncements.messageTemplateLabel'),
    )) as HTMLTextAreaElement;
    expect(template.disabled).toBe(true);
    expect(screen.queryByRole('button', { name: t('shopCommon.save') })).not.toBeInTheDocument();
  });
});
