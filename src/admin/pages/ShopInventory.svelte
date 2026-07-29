<script lang="ts">
  import { onMount } from 'svelte';
  import type { ShopInventoryData, ShopInventoryRow, ShopProductRow } from '../types';
  import { apiGet, apiPost } from '../api';
  import { auth } from '../state/auth.svelte';
  import { SEARCH_DEBOUNCE_MS } from '../state/poll';
  import { localizeAdminError, t } from '../i18n';
  import { fmtDate } from '../format';
  import Panel from '../components/Panel.svelte';
  import PageHeader from '../components/PageHeader.svelte';
  import Pager from '../components/Pager.svelte';
  import Badge from '../components/Badge.svelte';
  import ModalDialog from '../components/ModalDialog.svelte';

  // Inventory tab of the shop catalog admin UI (Phase 2 over the Phase 1
  // backend: server/shop_inventory_routes.ts). List (with a low-stock filter)
  // + start tracking a product (inline form) + adjust stock (modal, records an
  // audit row server-side) + stop tracking (delete, confirm).

  let list = $state<ShopInventoryData | null>(null);
  let failed = $state(false);
  let search = $state('');
  let page = $state(1);
  let lowStockOnly = $state(false);
  let sort = $state<'quantity' | 'updatedAt'>('updatedAt');
  let dir = $state<'asc' | 'desc'>('desc');
  let searchTimer: ReturnType<typeof setTimeout> | null = null;

  // A flat product set for the "start tracking" picker; not filtered/paginated
  // like the main list, so any product is choosable regardless of the list's
  // current search/sort state.
  let products = $state<ShopProductRow[]>([]);

  let canManage = $derived(auth.can('shop.manage'));

  async function refresh(): Promise<void> {
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: '20',
        q: search,
        sort,
        dir,
      });
      if (lowStockOnly) params.set('lowStock', 'true');
      list = await apiGet<ShopInventoryData>(`/admin/api/shop/inventory?${params}`);
      failed = false;
    } catch (err) {
      if (!auth.handleAuthFailure(err)) failed = true;
    }
  }

  async function refreshProducts(): Promise<void> {
    try {
      const params = new URLSearchParams({ page: '1', limit: '100', sort: 'name', dir: 'asc' });
      const res = await apiGet<{ rows: ShopProductRow[] }>(`/admin/api/shop/products?${params}`);
      products = res.rows;
    } catch (err) {
      if (!auth.handleAuthFailure(err)) window.alert(t('shopInventory.productsLoadFailed'));
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

  function isLowStock(row: ShopInventoryRow): boolean {
    return !row.unlimited && row.quantityOnHand <= row.lowStockThreshold;
  }

  // ---- Start tracking ----
  let newProductId = $state('');
  let newQuantity = $state('0');
  let newThreshold = $state('0');
  let newUnlimited = $state(false);
  let newReason = $state('');
  let createSaving = $state(false);

  function resetCreateForm(): void {
    newProductId = '';
    newQuantity = '0';
    newThreshold = '0';
    newUnlimited = false;
    newReason = '';
  }

  async function submitCreate(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    if (!newProductId || createSaving) return;
    createSaving = true;
    try {
      await apiPost('/admin/api/shop/inventory', {
        productId: Number(newProductId),
        quantityOnHand: Number(newQuantity) || 0,
        lowStockThreshold: Number(newThreshold) || 0,
        unlimited: newUnlimited,
        reason: newReason.trim(),
      });
      resetCreateForm();
      await refresh();
    } catch (err) {
      fail(err, 'shopInventory.saveFailed');
    } finally {
      createSaving = false;
    }
  }

  // ---- Adjust ----
  let editing = $state<ShopInventoryRow | null>(null);
  let editQuantity = $state('0');
  let editThreshold = $state('0');
  let editUnlimited = $state(false);
  let editReason = $state('');
  let editSaving = $state(false);

  function openEdit(row: ShopInventoryRow): void {
    editing = row;
    editQuantity = String(row.quantityOnHand);
    editThreshold = String(row.lowStockThreshold);
    editUnlimited = row.unlimited;
    editReason = '';
  }

  function closeEdit(): void {
    editing = null;
  }

  async function submitEdit(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    if (!editing || editSaving) return;
    editSaving = true;
    try {
      await apiPost(`/admin/api/shop/inventory/${editing.id}`, {
        quantityOnHand: Number(editQuantity) || 0,
        lowStockThreshold: Number(editThreshold) || 0,
        unlimited: editUnlimited,
        reason: editReason.trim(),
      });
      editing = null;
      await refresh();
    } catch (err) {
      fail(err, 'shopInventory.saveFailed');
    } finally {
      editSaving = false;
    }
  }

  async function remove(row: ShopInventoryRow): Promise<void> {
    if (!window.confirm(t('shopInventory.confirmDelete', { name: row.productName }))) return;
    try {
      await apiPost(`/admin/api/shop/inventory/${row.id}/delete`, {});
      await refresh();
    } catch (err) {
      fail(err, 'shopInventory.deleteFailed');
    }
  }

  onMount(() => {
    void refresh();
    void refreshProducts();
    return () => {
      if (searchTimer) clearTimeout(searchTimer);
    };
  });
</script>

<PageHeader title={t('nav.shopInventory')} />

{#if canManage}
  <Panel title={t('shopInventory.addTitle')}>
    <form class="shop-form" onsubmit={submitCreate}>
      <label>{t('shopInventory.productLabel')}
        <select bind:value={newProductId} required>
          <option value="" disabled>{t('shopInventory.productPlaceholder')}</option>
          {#each products as p (p.id)}
            <option value={String(p.id)}>{p.sku} - {p.name}</option>
          {/each}
        </select>
      </label>
      <label>{t('shopInventory.quantityLabel')}
        <input inputmode="numeric" pattern="[0-9]*" bind:value={newQuantity} />
      </label>
      <label>{t('shopInventory.thresholdLabel')}
        <input inputmode="numeric" pattern="[0-9]*" bind:value={newThreshold} />
      </label>
      <label class="shop-checkbox"><input type="checkbox" bind:checked={newUnlimited} /> {t('shopInventory.unlimitedLabel')}</label>
      <label class="shop-field-wide">{t('shopInventory.reasonLabel')}
        <input placeholder={t('shopInventory.reasonPlaceholder')} maxlength="500" bind:value={newReason} />
      </label>
      <button disabled={createSaving}>{createSaving ? t('shopCommon.saving') : t('shopInventory.add')}</button>
    </form>
  </Panel>
{/if}

<Panel title={t('shopInventory.listTitle')}>
  <div class="shop-controls">
    <input
      placeholder={t('shopInventory.searchPlaceholder')}
      value={search}
      oninput={onSearchInput}
    />
    <label class="shop-checkbox shop-inline-checkbox">
      <input type="checkbox" bind:checked={lowStockOnly} onchange={onFilterChange} />
      {t('shopInventory.lowStockOnly')}
    </label>
    <select bind:value={sort} onchange={onFilterChange}>
      <option value="updatedAt">{t('shopInventory.sortLabel')}: {t('shopInventory.sortUpdated')}</option>
      <option value="quantity">{t('shopInventory.sortLabel')}: {t('shopInventory.sortQuantity')}</option>
    </select>
    {#if list}
      <div class="pager">
        <Pager total={list.total} page={list.page} limit={list.limit} onPage={(p) => { page = p; void refresh(); }} />
      </div>
    {/if}
  </div>

  {#if failed}
    <div class="empty">{t('shopInventory.loadFailed')}</div>
  {:else if list && list.rows.length === 0}
    <div class="empty">{t('shopInventory.empty')}</div>
  {:else if list}
    <table>
      <thead>
        <tr>
          <th class="num">{t('shopInventory.colId')}</th>
          <th>{t('shopInventory.colProduct')}</th>
          <th class="num">{t('shopInventory.colOnHand')}</th>
          <th class="num">{t('shopInventory.colReserved')}</th>
          <th class="num">{t('shopInventory.colThreshold')}</th>
          <th>{t('shopInventory.colUpdated')}</th>
          {#if canManage}<th>{t('shopCommon.colActions')}</th>{/if}
        </tr>
      </thead>
      <tbody>
        {#each list.rows as row (row.id)}
          <tr>
            <td class="num">{row.id}</td>
            <td>
              {row.productSku} - {row.productName}
              {#if row.unlimited}<Badge variant="neutral">{t('shopInventory.unlimitedBadge')}</Badge>{/if}
              {#if isLowStock(row)}<Badge variant="warn">{t('shopInventory.lowStockBadge')}</Badge>{/if}
            </td>
            <td class="num">{row.quantityOnHand}</td>
            <td class="num">{row.quantityReserved}</td>
            <td class="num">{row.lowStockThreshold}</td>
            <td>{fmtDate(row.updatedAt)}</td>
            {#if canManage}
              <td>
                <button onclick={() => openEdit(row)}>{t('shopCommon.edit')}</button>
                <button onclick={() => remove(row)}>{t('shopInventory.stopTracking')}</button>
              </td>
            {/if}
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</Panel>

{#if editing}
  <ModalDialog labelledBy="shop-inventory-edit-title" closeLabel={t('shopCommon.close')} width="520px" onClose={closeEdit}>
    <div class="shop-modal-content">
      <h2 id="shop-inventory-edit-title">
        {t('shopInventory.editTitle')}: {editing.productSku} - {editing.productName}
      </h2>
      <form class="shop-form" onsubmit={submitEdit}>
        <label>{t('shopInventory.quantityLabel')}
          <input inputmode="numeric" pattern="[0-9]*" bind:value={editQuantity} data-modal-focus />
        </label>
        <label>{t('shopInventory.thresholdLabel')}
          <input inputmode="numeric" pattern="[0-9]*" bind:value={editThreshold} />
        </label>
        <label class="shop-checkbox"><input type="checkbox" bind:checked={editUnlimited} /> {t('shopInventory.unlimitedLabel')}</label>
        <label class="shop-field-wide">{t('shopInventory.reasonLabel')}
          <input placeholder={t('shopInventory.reasonPlaceholder')} maxlength="500" bind:value={editReason} />
        </label>
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

  .shop-inline-checkbox {
    flex-direction: row;
    align-items: center;
    gap: 6px;
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

  .shop-modal-content {
    padding: 20px;
  }

  .shop-modal-content h2 {
    margin: 0 0 14px;
    color: var(--gold);
    font-size: 16px;
  }

  .shop-modal-actions {
    grid-column: 1 / -1;
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    margin-top: 6px;
  }
</style>
