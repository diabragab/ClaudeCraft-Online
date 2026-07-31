<script lang="ts">
  import { onMount } from 'svelte';
  import { apiGet, apiPost } from '../api';
  import { auth } from '../state/auth.svelte';
  import { localizeAdminError, t } from '../i18n';
  import { fmtDate } from '../format';
  import PageHeader from '../components/PageHeader.svelte';
  import Panel from '../components/Panel.svelte';
  import type {
    DiscordWebhookTestResult,
    ShopAnnouncementConfig,
    ShopAnnouncementConfigData,
    ShopAnnouncementConfigHistory,
    ShopAnnouncementConfigHistoryEntry,
    ShopRarity,
  } from '../types';
  import { RARITY_TIERS } from '../types';

  // The Premium Shop's rarity-gated purchase-announcement config (Phase 2E,
  // server/shop_announcement_config_routes.ts): a small fixed field set (not
  // a dynamic catalog like AntibotConfig), so this is a plain form rather
  // than that page's schema-driven renderer.

  const RARITY_LABEL_KEY: Record<ShopRarity, string> = {
    common: 'shopProducts.rarityCommon',
    uncommon: 'shopProducts.rarityUncommon',
    rare: 'shopProducts.rarityRare',
    epic: 'shopProducts.rarityEpic',
    legendary: 'shopProducts.rarityLegendary',
    mythic: 'shopProducts.rarityMythic',
  };

  const PREVIEW_SAMPLE = { player: 'Aria', item: 'Cinderbrand Sword', rarity: 'epic' };

  let canManage = $derived(auth.can('shop.manage'));

  let updatedAt = $state<string | null>(null);
  let failed = $state(false);
  let loaded = $state(false);

  let enabled = $state(true);
  let minRarity = $state<ShopRarity>('epic');
  let messageTemplate = $state('');
  let discordWebhookEnabled = $state(false);
  let discordWebhookUrl = $state('');
  let note = $state('');
  let saving = $state(false);
  let savedFlash = $state(false);

  let testing = $state(false);
  let testResult = $state<DiscordWebhookTestResult | null>(null);

  let historyEntries = $state<ShopAnnouncementConfigHistoryEntry[]>([]);
  let historyFailed = $state(false);

  const preview = $derived(
    messageTemplate
      .replaceAll('{player}', PREVIEW_SAMPLE.player)
      .replaceAll('{item}', PREVIEW_SAMPLE.item)
      .replaceAll('{rarity}', PREVIEW_SAMPLE.rarity),
  );

  function adopt(config: ShopAnnouncementConfig, savedAt: string | null): void {
    enabled = config.enabled;
    minRarity = config.minRarity;
    messageTemplate = config.messageTemplate;
    discordWebhookEnabled = config.discordWebhookEnabled;
    discordWebhookUrl = config.discordWebhookUrl;
    updatedAt = savedAt;
  }

  async function refresh(): Promise<void> {
    try {
      const data = await apiGet<ShopAnnouncementConfigData>('/admin/api/shop/announcement-config');
      adopt(data.config, data.updatedAt);
      failed = false;
    } catch (err) {
      if (!auth.handleAuthFailure(err)) failed = true;
    } finally {
      loaded = true;
    }
  }

  async function refreshHistory(): Promise<void> {
    try {
      const history = await apiGet<ShopAnnouncementConfigHistory>(
        '/admin/api/shop/announcement-config/history',
      );
      historyEntries = history.entries;
      historyFailed = false;
    } catch (err) {
      if (!auth.handleAuthFailure(err)) historyFailed = true;
    }
  }

  async function save(): Promise<void> {
    if (saving) return;
    saving = true;
    testResult = null;
    try {
      const data = await apiPost<ShopAnnouncementConfigData>('/admin/api/shop/announcement-config', {
        enabled,
        minRarity,
        messageTemplate,
        discordWebhookEnabled,
        discordWebhookUrl,
        note,
      });
      adopt(data.config, data.updatedAt);
      note = '';
      await refreshHistory();
      savedFlash = true;
      setTimeout(() => {
        savedFlash = false;
      }, 2500);
    } catch (err) {
      if (!auth.handleAuthFailure(err)) {
        window.alert(
          err instanceof Error ? localizeAdminError(err.message) : t('shopAnnouncements.saveFailed'),
        );
      }
    } finally {
      saving = false;
    }
  }

  async function sendTest(): Promise<void> {
    if (testing) return;
    testing = true;
    testResult = null;
    try {
      testResult = await apiPost<DiscordWebhookTestResult>(
        '/admin/api/shop/announcement-config/test-discord',
        discordWebhookUrl.trim() ? { url: discordWebhookUrl.trim() } : {},
      );
    } catch (err) {
      if (!auth.handleAuthFailure(err)) {
        testResult = { ok: false, status: null, error: localizeAdminError((err as Error).message) };
      }
    } finally {
      testing = false;
    }
  }

  function loadHistoryVersion(entry: ShopAnnouncementConfigHistoryEntry): void {
    const after = entry.afterData;
    if (after.enabled !== undefined) enabled = after.enabled;
    if (after.minRarity !== undefined) minRarity = after.minRarity;
    if (after.messageTemplate !== undefined) messageTemplate = after.messageTemplate;
    if (after.discordWebhookEnabled !== undefined) discordWebhookEnabled = after.discordWebhookEnabled;
    if (after.discordWebhookUrl !== undefined) discordWebhookUrl = after.discordWebhookUrl;
  }

  onMount(() => {
    void refresh();
    void refreshHistory();
  });
</script>

<PageHeader title={t('nav.shopAnnouncements')} />

<Panel title={t('shopAnnouncements.title')}>
  {#if failed}
    <p class="sa-error">{t('shopAnnouncements.loadFailed')}</p>
  {:else if !loaded}
    <p class="sa-note">{t('shopAnnouncements.loading')}</p>
  {:else}
    <p class="sa-note">
      {updatedAt === null
        ? t('shopAnnouncements.neverSaved')
        : t('shopAnnouncements.updatedAt', { value: fmtDate(updatedAt) })}
    </p>

    <div class="sa-form">
      <label class="sa-checkbox">
        <input type="checkbox" bind:checked={enabled} disabled={!canManage} />
        {t('shopAnnouncements.enabledLabel')}
      </label>
      <div class="sa-hint">{t('shopAnnouncements.enabledHint')}</div>

      <label>{t('shopAnnouncements.minRarityLabel')}
        <select bind:value={minRarity} disabled={!canManage}>
          {#each RARITY_TIERS as rarity (rarity)}
            <option value={rarity}>{t(RARITY_LABEL_KEY[rarity])}</option>
          {/each}
        </select>
      </label>
      <div class="sa-hint">{t('shopAnnouncements.minRarityHint')}</div>

      <label>{t('shopAnnouncements.messageTemplateLabel')}
        <textarea
          rows="2"
          maxlength="300"
          bind:value={messageTemplate}
          disabled={!canManage}
        ></textarea>
      </label>
      <div class="sa-hint">{t('shopAnnouncements.messageTemplateHint')}</div>
      <div class="sa-preview">
        <span class="sa-preview-label">{t('shopAnnouncements.previewLabel')}</span>
        <span class="sa-preview-text">{preview}</span>
      </div>

      <label class="sa-checkbox">
        <input type="checkbox" bind:checked={discordWebhookEnabled} disabled={!canManage} />
        {t('shopAnnouncements.discordEnabledLabel')}
      </label>
      <label>{t('shopAnnouncements.discordUrlLabel')}
        <input
          type="text"
          maxlength="300"
          placeholder={t('shopAnnouncements.discordUrlPlaceholder')}
          bind:value={discordWebhookUrl}
          disabled={!canManage || !discordWebhookEnabled}
        />
      </label>
      <div class="sa-test-row">
        <button
          type="button"
          onclick={() => void sendTest()}
          disabled={!canManage || testing || discordWebhookUrl.trim() === ''}
        >
          {testing ? t('shopAnnouncements.testing') : t('shopAnnouncements.sendTest')}
        </button>
        {#if testResult}
          <span class="sa-test-result" class:sa-test-ok={testResult.ok} class:sa-test-fail={!testResult.ok}>
            {testResult.ok
              ? t('shopAnnouncements.testSucceeded')
              : t('shopAnnouncements.testFailed', { error: testResult.error ?? '' })}
          </span>
        {/if}
      </div>

      {#if canManage}
        <div class="sa-actions">
          <label class="sa-note-field">
            <span>{t('shopAnnouncements.changeNoteLabel')}</span>
            <input
              type="text"
              maxlength="300"
              placeholder={t('shopAnnouncements.changeNotePlaceholder')}
              bind:value={note}
              disabled={saving}
            />
          </label>
          <button type="button" class="sa-save" onclick={() => void save()} disabled={saving}>
            {saving ? t('shopCommon.saving') : t('shopCommon.save')}
          </button>
          {#if savedFlash}<span class="sa-saved">{t('shopAnnouncements.saved')}</span>{/if}
        </div>
      {/if}
    </div>
  {/if}
</Panel>

<Panel title={t('shopAnnouncements.historyTitle')}>
  {#if historyFailed}
    <p class="sa-error">{t('shopAnnouncements.historyLoadFailed')}</p>
  {:else if historyEntries.length === 0}
    <p class="sa-note">{t('shopAnnouncements.historyEmpty')}</p>
  {:else}
    <table>
      <thead>
        <tr>
          <th>{t('shopAnnouncements.colWhen')}</th>
          <th>{t('shopAnnouncements.colAdmin')}</th>
          <th>{t('shopAnnouncements.colNote')}</th>
          {#if canManage}<th>{t('shopCommon.colActions')}</th>{/if}
        </tr>
      </thead>
      <tbody>
        {#each historyEntries as entry (entry.id)}
          <tr>
            <td>{fmtDate(entry.createdAt)}</td>
            <td>{entry.adminUsername ?? t('shopAnnouncements.unknownAdmin')}</td>
            <td>{entry.note}</td>
            {#if canManage}
              <td><button type="button" onclick={() => loadHistoryVersion(entry)}>{t('shopAnnouncements.restore')}</button></td>
            {/if}
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</Panel>

<style>
  .sa-note {
    color: var(--text-soft);
    margin: 4px 0 14px;
  }
  .sa-error {
    color: var(--color-danger);
    margin: 4px 0 14px;
  }
  .sa-form {
    display: grid;
    gap: 6px;
    max-width: 640px;
  }
  .sa-form label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 12px;
    color: var(--text-dim);
    margin-top: 10px;
  }
  .sa-checkbox {
    flex-direction: row !important;
    align-items: center;
    gap: 6px !important;
  }
  .sa-hint {
    font-size: 12px;
    color: var(--text-dim);
  }
  .sa-preview {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 8px 10px;
    margin-top: 4px;
    border: 1px solid var(--border-subtle);
    border-radius: 4px;
    background: var(--surface-inset);
  }
  .sa-preview-label {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-soft);
  }
  .sa-preview-text {
    color: var(--gold);
  }
  .sa-test-row {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 10px;
  }
  .sa-test-result {
    font-size: 12px;
  }
  .sa-test-ok {
    color: var(--color-success, #7fe07f);
  }
  .sa-test-fail {
    color: var(--color-danger);
  }
  .sa-actions {
    display: flex;
    align-items: flex-end;
    gap: 10px;
    margin-top: 16px;
    padding-top: 12px;
    border-top: 1px solid var(--border-subtle);
  }
  .sa-note-field {
    flex: 1;
    margin-top: 0 !important;
  }
  .sa-save {
    background: linear-gradient(#4a3a14, #241c08);
    color: var(--gold);
    border-color: var(--gold-dim);
    font-weight: 600;
  }
  .sa-saved {
    color: var(--text-soft);
    align-self: center;
  }
</style>
