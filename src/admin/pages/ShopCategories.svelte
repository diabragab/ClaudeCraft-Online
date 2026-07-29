<script lang="ts">
  import { onMount } from 'svelte';
  import type { ShopCategoriesData, ShopCategoryRow, ShopCategoryStatus } from '../types';
  import { apiGet, apiPost } from '../api';
  import { auth } from '../state/auth.svelte';
  import { SEARCH_DEBOUNCE_MS } from '../state/poll';
  import { localizeAdminError, t } from '../i18n';
  import { fmtDate } from '../format';
  import Panel from '../components/Panel.svelte';
  import PageHeader from '../components/PageHeader.svelte';
  import Pager from '../components/Pager.svelte';
  import ModalDialog from '../components/ModalDialog.svelte';

  // Categories tab of the shop catalog admin UI (Phase 2 over the Phase 1
  // backend: server/shop_categories_routes.ts). List + create (inline form,
  // mirroring BlockedIps.svelte) + edit (modal) + delete (confirm).

  let list = $state<ShopCategoriesData | null>(null);
  let failed = $state(false);
  let search = $state('');
  let page = $state(1);
  let statusFilter = $state('');
  let parentFilter = $state('');
  let sort = $state<'name' | 'sortOrder' | 'createdAt'>('sortOrder');
  let dir = $state<'asc' | 'desc'>('asc');
  let searchTimer: ReturnType<typeof setTimeout> | null = null;

  // A flat, larger, name-sorted set for the parent-category pickers (create form
  // + edit modal). Separate from the main (filtered/paginated) list so a status
  // or search filter on the list never hides a valid parent choice.
  let parentOptions = $state<ShopCategoryRow[]>([]);

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
      if (statusFilter) params.set('status', statusFilter);
      if (parentFilter) params.set('parentId', parentFilter);
      list = await apiGet<ShopCategoriesData>(`/admin/api/shop/categories?${params}`);
      failed = false;
    } catch (err) {
      if (!auth.handleAuthFailure(err)) failed = true;
    }
  }

  async function refreshParentOptions(): Promise<void> {
    try {
      const params = new URLSearchParams({ page: '1', limit: '100', sort: 'name', dir: 'asc' });
      const res = await apiGet<ShopCategoriesData>(`/admin/api/shop/categories?${params}`);
      parentOptions = res.rows;
    } catch (err) {
      auth.handleAuthFailure(err);
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

  function categoryName(id: number | null): string {
    if (id === null) return t('shopCategories.rootLabel');
    return parentOptions.find((c) => c.id === id)?.name ?? `#${id}`;
  }

  // ---- Create ----
  let newName = $state('');
  let newSlug = $state('');
  let newDescription = $state('');
  let newParentId = $state('');
  let newSortOrder = $state('0');
  let newStatus = $state<ShopCategoryStatus>('active');
  let createSaving = $state(false);

  function resetCreateForm(): void {
    newName = '';
    newSlug = '';
    newDescription = '';
    newParentId = '';
    newSortOrder = '0';
    newStatus = 'active';
  }

  async function submitCreate(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    if (!newName.trim() || !newSlug.trim() || createSaving) return;
    createSaving = true;
    try {
      await apiPost('/admin/api/shop/categories', {
        name: newName.trim(),
        slug: newSlug.trim(),
        description: newDescription.trim(),
        parentId: newParentId === '' ? 0 : Number(newParentId),
        sortOrder: Number(newSortOrder) || 0,
        status: newStatus,
      });
      resetCreateForm();
      await Promise.all([refresh(), refreshParentOptions()]);
    } catch (err) {
      fail(err, 'shopCategories.saveFailed');
    } finally {
      createSaving = false;
    }
  }

  // ---- Edit ----
  let editing = $state<ShopCategoryRow | null>(null);
  let editName = $state('');
  let editSlug = $state('');
  let editDescription = $state('');
  let editParentId = $state('');
  let editSortOrder = $state('0');
  let editStatus = $state<ShopCategoryStatus>('active');
  let editSaving = $state(false);

  function openEdit(row: ShopCategoryRow): void {
    editing = row;
    editName = row.name;
    editSlug = row.slug;
    editDescription = row.description;
    editParentId = row.parentId === null ? '' : String(row.parentId);
    editSortOrder = String(row.sortOrder);
    editStatus = row.status;
  }

  function closeEdit(): void {
    editing = null;
  }

  async function submitEdit(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    if (!editing || editSaving) return;
    editSaving = true;
    try {
      await apiPost(`/admin/api/shop/categories/${editing.id}`, {
        name: editName.trim(),
        slug: editSlug.trim(),
        description: editDescription.trim(),
        parentId: editParentId === '' ? 0 : Number(editParentId),
        sortOrder: Number(editSortOrder) || 0,
        status: editStatus,
      });
      editing = null;
      await Promise.all([refresh(), refreshParentOptions()]);
    } catch (err) {
      fail(err, 'shopCategories.saveFailed');
    } finally {
      editSaving = false;
    }
  }

  async function remove(row: ShopCategoryRow): Promise<void> {
    if (!window.confirm(t('shopCategories.confirmDelete', { name: row.name }))) return;
    try {
      await apiPost(`/admin/api/shop/categories/${row.id}/delete`, {});
      await Promise.all([refresh(), refreshParentOptions()]);
    } catch (err) {
      fail(err, 'shopCategories.deleteFailed');
    }
  }

  onMount(() => {
    void refresh();
    void refreshParentOptions();
    return () => {
      if (searchTimer) clearTimeout(searchTimer);
    };
  });
</script>

<PageHeader title={t('nav.shopCategories')} />

{#if canManage}
  <Panel title={t('shopCategories.addTitle')}>
    <form class="shop-form" onsubmit={submitCreate}>
      <label>{t('shopCategories.nameLabel')}
        <input placeholder={t('shopCategories.namePlaceholder')} maxlength="120" bind:value={newName} required />
      </label>
      <label>{t('shopCategories.slugLabel')}
        <input placeholder={t('shopCategories.slugPlaceholder')} maxlength="80" bind:value={newSlug} required />
      </label>
      <label class="shop-field-wide">{t('shopCategories.descriptionLabel')}
        <input maxlength="2000" bind:value={newDescription} />
      </label>
      <label>{t('shopCategories.parentLabel')}
        <select bind:value={newParentId}>
          <option value="">{t('shopCategories.parentNone')}</option>
          {#each parentOptions as c (c.id)}
            <option value={String(c.id)}>{c.name}</option>
          {/each}
        </select>
      </label>
      <label>{t('shopCategories.sortOrderLabel')}
        <input type="number" bind:value={newSortOrder} />
      </label>
      <label>{t('shopCategories.statusLabel')}
        <select bind:value={newStatus}>
          <option value="active">{t('shopCategories.statusActive')}</option>
          <option value="archived">{t('shopCategories.statusArchived')}</option>
        </select>
      </label>
      <button disabled={createSaving}>{createSaving ? t('shopCommon.saving') : t('shopCategories.add')}</button>
    </form>
  </Panel>
{/if}

<Panel title={t('shopCategories.listTitle')}>
  <div class="shop-controls">
    <input
      placeholder={t('shopCategories.searchPlaceholder')}
      value={search}
      oninput={onSearchInput}
    />
    <select bind:value={statusFilter} onchange={onFilterChange}>
      <option value="">{t('shopCommon.allStatuses')}</option>
      <option value="active">{t('shopCategories.statusActive')}</option>
      <option value="archived">{t('shopCategories.statusArchived')}</option>
    </select>
    <select bind:value={parentFilter} onchange={onFilterChange}>
      <option value="">{t('shopCategories.filterAllParents')}</option>
      <option value="0">{t('shopCategories.filterRootOnly')}</option>
    </select>
    <select bind:value={sort} onchange={onFilterChange}>
      <option value="sortOrder">{t('shopCategories.sortLabel')}: {t('shopCategories.sortOrder')}</option>
      <option value="name">{t('shopCategories.sortLabel')}: {t('shopCategories.sortName')}</option>
      <option value="createdAt">{t('shopCategories.sortLabel')}: {t('shopCategories.sortCreated')}</option>
    </select>
    {#if list}
      <div class="pager">
        <Pager total={list.total} page={list.page} limit={list.limit} onPage={(p) => { page = p; void refresh(); }} />
      </div>
    {/if}
  </div>

  {#if failed}
    <div class="empty">{t('shopCategories.loadFailed')}</div>
  {:else if list && list.rows.length === 0}
    <div class="empty">{t('shopCategories.empty')}</div>
  {:else if list}
    <table>
      <thead>
        <tr>
          <th class="num">{t('shopCategories.colId')}</th>
          <th>{t('shopCategories.colName')}</th>
          <th>{t('shopCategories.colSlug')}</th>
          <th>{t('shopCategories.colParent')}</th>
          <th class="num">{t('shopCategories.colSortOrder')}</th>
          <th>{t('shopCategories.colStatus')}</th>
          {#if canManage}<th>{t('shopCommon.colActions')}</th>{/if}
        </tr>
      </thead>
      <tbody>
        {#each list.rows as row (row.id)}
          <tr>
            <td class="num">{row.id}</td>
            <td>{row.name}</td>
            <td>{row.slug}</td>
            <td>{categoryName(row.parentId)}</td>
            <td class="num">{row.sortOrder}</td>
            <td>{row.status === 'active' ? t('shopCategories.statusActive') : t('shopCategories.statusArchived')}</td>
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
  <ModalDialog labelledBy="shop-category-edit-title" closeLabel={t('shopCommon.close')} width="600px" onClose={closeEdit}>
    <div class="shop-modal-content">
      <h2 id="shop-category-edit-title">{t('shopCategories.editTitle')}</h2>
      <form class="shop-form" onsubmit={submitEdit}>
        <label>{t('shopCategories.nameLabel')}
          <input maxlength="120" bind:value={editName} required data-modal-focus />
        </label>
        <label>{t('shopCategories.slugLabel')}
          <input maxlength="80" bind:value={editSlug} required />
        </label>
        <label class="shop-field-wide">{t('shopCategories.descriptionLabel')}
          <input maxlength="2000" bind:value={editDescription} />
        </label>
        <label>{t('shopCategories.parentLabel')}
          <select bind:value={editParentId}>
            <option value="">{t('shopCategories.parentNone')}</option>
            {#each parentOptions.filter((c) => c.id !== editing?.id) as c (c.id)}
              <option value={String(c.id)}>{c.name}</option>
            {/each}
          </select>
        </label>
        <label>{t('shopCategories.sortOrderLabel')}
          <input type="number" bind:value={editSortOrder} />
        </label>
        <label>{t('shopCategories.statusLabel')}
          <select bind:value={editStatus}>
            <option value="active">{t('shopCategories.statusActive')}</option>
            <option value="archived">{t('shopCategories.statusArchived')}</option>
          </select>
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

  .shop-field-wide {
    grid-column: 1 / -1;
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
