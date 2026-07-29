<script lang="ts">
  import { onMount } from 'svelte';
  import type { ClaudiumPackageRow, ClaudiumPackagesData } from '../types';
  import { apiGet, apiPost } from '../api';
  import { auth } from '../state/auth.svelte';
  import { SEARCH_DEBOUNCE_MS } from '../state/poll';
  import { localizeAdminError, t } from '../i18n';
  import { fmtDecimal } from '../format';
  import Panel from '../components/Panel.svelte';
  import PageHeader from '../components/PageHeader.svelte';
  import Pager from '../components/Pager.svelte';
  import ModalDialog from '../components/ModalDialog.svelte';

  // Claudium Packages tab (Phase 7 over server/claudium_packages_routes.ts):
  // the admin-managed catalog of Claudium purchase tiers (Starter/Bronze/
  // Silver/Gold/Diamond Pack, ...). List + create (inline form) + edit
  // (modal) + delete (confirm), mirroring ShopProducts.svelte structurally.

  let list = $state<ClaudiumPackagesData | null>(null);
  let failed = $state(false);
  let search = $state('');
  let page = $state(1);
  let enabledFilter = $state('');
  let sort = $state<'displayOrder' | 'name' | 'createdAt' | 'updatedAt'>('displayOrder');
  let dir = $state<'asc' | 'desc'>('asc');
  let searchTimer: ReturnType<typeof setTimeout> | null = null;

  let canManage = $derived(auth.can('shop.manage'));

  async function refresh(): Promise<void> {
    try {
      const params = new URLSearchParams({ page: String(page), limit: '20', q: search, sort, dir });
      if (enabledFilter) params.set('enabled', enabledFilter);
      list = await apiGet<ClaudiumPackagesData>(`/admin/api/shop/packages?${params}`);
      failed = false;
    } catch (err) {
      if (!auth.handleAuthFailure(err)) failed = true;
    }
  }

  function fail(err: unknown, fallbackKey: string): void {
    if (!auth.handleAuthFailure(err)) {
      window.alert(err instanceof Error ? localizeAdminError(err.message) : t(fallbackKey));
    }
  }

  function onSearchInput(event: Event): void {
    search = (event.currentTarget as HTMLInputElement).value.trim();
    page = 1;
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => void refresh(), SEARCH_DEBOUNCE_MS);
  }

  function onFilterChange(): void {
    page = 1;
    void refresh();
  }

  function priceSummary(row: ClaudiumPackageRow): string {
    return `${fmtDecimal(row.price / 100)} ${row.currency}`;
  }

  interface PackageForm {
    name: string;
    claudiumAmount: string;
    bonusAmount: string;
    price: string;
    currency: string;
    stripePriceId: string;
    enabled: boolean;
    displayOrder: string;
  }

  function emptyForm(): PackageForm {
    return {
      name: '',
      claudiumAmount: '',
      bonusAmount: '',
      price: '',
      currency: 'USD',
      stripePriceId: '',
      enabled: true,
      displayOrder: '0',
    };
  }

  function formBody(form: PackageForm) {
    return {
      name: form.name.trim(),
      claudiumAmount: Number(form.claudiumAmount) || 0,
      bonusAmount: Number(form.bonusAmount) || 0,
      price: Number(form.price) || 0,
      currency: form.currency.trim() || 'USD',
      stripePriceId: form.stripePriceId.trim(),
      enabled: form.enabled,
      displayOrder: Number(form.displayOrder) || 0,
    };
  }

  // ---- Create ----
  let createForm = $state(emptyForm());
  let createSaving = $state(false);

  async function submitCreate(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    if (!createForm.name.trim() || !createForm.claudiumAmount.trim() || createSaving) return;
    createSaving = true;
    try {
      await apiPost('/admin/api/shop/packages', formBody(createForm));
      createForm = emptyForm();
      await refresh();
    } catch (err) {
      fail(err, 'claudiumPackages.saveFailed');
    } finally {
      createSaving = false;
    }
  }

  // ---- Edit ----
  let editing = $state<ClaudiumPackageRow | null>(null);
  let editForm = $state(emptyForm());
  let editSaving = $state(false);

  function openEdit(row: ClaudiumPackageRow): void {
    editing = row;
    editForm = {
      name: row.name,
      claudiumAmount: String(row.claudiumAmount),
      bonusAmount: String(row.bonusAmount),
      price: String(row.price),
      currency: row.currency,
      stripePriceId: row.stripePriceId ?? '',
      enabled: row.enabled,
      displayOrder: String(row.displayOrder),
    };
  }

  function closeEdit(): void {
    editing = null;
  }

  async function submitEdit(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    if (!editing || editSaving) return;
    editSaving = true;
    try {
      await apiPost(`/admin/api/shop/packages/${editing.id}`, formBody(editForm));
      editing = null;
      await refresh();
    } catch (err) {
      fail(err, 'claudiumPackages.saveFailed');
    } finally {
      editSaving = false;
    }
  }

  async function remove(row: ClaudiumPackageRow): Promise<void> {
    if (!window.confirm(t('claudiumPackages.confirmDelete', { name: row.name }))) return;
    try {
      await apiPost(`/admin/api/shop/packages/${row.id}/delete`, {});
      await refresh();
    } catch (err) {
      fail(err, 'claudiumPackages.deleteFailed');
    }
  }

  onMount(() => {
    void refresh();
    return () => {
      if (searchTimer) clearTimeout(searchTimer);
    };
  });
</script>

{#snippet packageFields(form: PackageForm, idPrefix: string)}
  <label>{t('claudiumPackages.nameLabel')}
    <input placeholder={t('claudiumPackages.namePlaceholder')} maxlength="120" bind:value={form.name} required data-modal-focus={idPrefix === 'edit' ? true : undefined} />
  </label>
  <label>{t('claudiumPackages.claudiumAmountLabel')}
    <input inputmode="numeric" pattern="[0-9]*" bind:value={form.claudiumAmount} required />
  </label>
  <label>{t('claudiumPackages.bonusAmountLabel')}
    <input inputmode="numeric" pattern="[0-9]*" placeholder="0" bind:value={form.bonusAmount} />
  </label>
  <label>{t('claudiumPackages.priceLabel')}
    <input inputmode="numeric" pattern="[0-9]*" bind:value={form.price} required />
  </label>
  <div class="shop-field-wide shop-hint">{t('claudiumPackages.priceHint')}</div>
  <label>{t('claudiumPackages.currencyLabel')}
    <input maxlength="8" bind:value={form.currency} />
  </label>
  <label>{t('claudiumPackages.stripePriceIdLabel')}
    <input placeholder={t('claudiumPackages.stripePriceIdPlaceholder')} maxlength="120" bind:value={form.stripePriceId} />
  </label>
  <label>{t('claudiumPackages.displayOrderLabel')}
    <input inputmode="numeric" pattern="[0-9]*" bind:value={form.displayOrder} />
  </label>
  <label class="shop-checkbox"><input type="checkbox" bind:checked={form.enabled} /> {t('claudiumPackages.enabledLabel')}</label>
{/snippet}

<PageHeader title={t('nav.shopPackages')} />

{#if canManage}
  <Panel title={t('claudiumPackages.addTitle')}>
    <form class="shop-form" onsubmit={submitCreate}>
      {@render packageFields(createForm, 'create')}
      <button disabled={createSaving}>{createSaving ? t('shopCommon.saving') : t('claudiumPackages.add')}</button>
    </form>
  </Panel>
{/if}

<Panel title={t('claudiumPackages.listTitle')}>
  <div class="shop-controls">
    <input
      placeholder={t('claudiumPackages.searchPlaceholder')}
      value={search}
      oninput={onSearchInput}
    />
    <select bind:value={enabledFilter} onchange={onFilterChange}>
      <option value="">{t('shopCommon.allStatuses')}</option>
      <option value="true">{t('claudiumPackages.enabledLabel')}</option>
      <option value="false">{t('claudiumPackages.disabledLabel')}</option>
    </select>
    <select bind:value={sort} onchange={onFilterChange}>
      <option value="displayOrder">{t('shopProducts.sortLabel')}: {t('claudiumPackages.sortDisplayOrder')}</option>
      <option value="name">{t('shopProducts.sortLabel')}: {t('shopProducts.sortName')}</option>
      <option value="createdAt">{t('shopProducts.sortLabel')}: {t('shopProducts.sortCreated')}</option>
      <option value="updatedAt">{t('shopProducts.sortLabel')}: {t('shopProducts.sortUpdated')}</option>
    </select>
    {#if list}
      <div class="pager">
        <Pager total={list.total} page={list.page} limit={list.limit} onPage={(p) => { page = p; void refresh(); }} />
      </div>
    {/if}
  </div>

  {#if failed}
    <div class="empty">{t('claudiumPackages.loadFailed')}</div>
  {:else if list && list.rows.length === 0}
    <div class="empty">{t('claudiumPackages.empty')}</div>
  {:else if list}
    <table>
      <thead>
        <tr>
          <th class="num">{t('shopProducts.colId')}</th>
          <th>{t('claudiumPackages.colName')}</th>
          <th class="num">{t('claudiumPackages.colClaudium')}</th>
          <th class="num">{t('claudiumPackages.colBonus')}</th>
          <th>{t('claudiumPackages.colPrice')}</th>
          <th>{t('shopProducts.colStatus')}</th>
          <th class="num">{t('claudiumPackages.colDisplayOrder')}</th>
          {#if canManage}<th>{t('shopCommon.colActions')}</th>{/if}
        </tr>
      </thead>
      <tbody>
        {#each list.rows as row (row.id)}
          <tr>
            <td class="num">{row.id}</td>
            <td>{row.name}</td>
            <td class="num">{row.claudiumAmount}</td>
            <td class="num">{row.bonusAmount}</td>
            <td>{priceSummary(row)}</td>
            <td>{row.enabled ? t('claudiumPackages.enabledLabel') : t('claudiumPackages.disabledLabel')}</td>
            <td class="num">{row.displayOrder}</td>
            {#if canManage}
              <td>
                <button onclick={() => openEdit(row)}>{t('shopCommon.edit')}</button>
                <button onclick={() => remove(row)}>{t('shopCommon.delete')}</button>
              </td>
            {/if}
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</Panel>

{#if editing}
  <ModalDialog labelledBy="claudium-package-edit-title" closeLabel={t('shopCommon.close')} width="600px" onClose={closeEdit}>
    <div class="shop-modal-content">
      <h2 id="claudium-package-edit-title">{t('claudiumPackages.editTitle')}</h2>
      <form class="shop-form" onsubmit={submitEdit}>
        {@render packageFields(editForm, 'edit')}
        <div class="shop-modal-actions">
          <button type="button" onclick={closeEdit}>{t('shopCommon.cancel')}</button>
          <button disabled={editSaving}>{editSaving ? t('shopCommon.saving') : t('shopCommon.save')}</button>
        </div>
      </form>
    </div>
  </ModalDialog>
{/if}

<style>
  .shop-controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
    margin-bottom: 14px;
  }

  .shop-controls .pager {
    margin-left: auto;
  }

  .shop-form {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 10px 14px;
    align-items: end;
  }

  .shop-form label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 12px;
    color: var(--text-dim);
  }

  .shop-checkbox {
    flex-direction: row !important;
    align-items: center;
    gap: 6px !important;
  }

  .shop-field-wide {
    grid-column: 1 / -1;
  }

  .shop-hint {
    font-size: 12px;
    color: var(--text-dim);
    margin-top: -4px;
  }

  .shop-modal-content {
    padding: 20px;
    max-height: calc(100vh - 96px);
    overflow-y: auto;
  }

  .shop-modal-content h2 {
    margin: 0 0 14px;
    color: var(--gold);
  }

  .shop-modal-actions {
    grid-column: 1 / -1;
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    margin-top: 6px;
  }
</style>
