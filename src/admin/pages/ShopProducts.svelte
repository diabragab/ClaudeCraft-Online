<script lang="ts">
  import { onMount } from 'svelte';
  import type {
    ShopCategoryRow,
    ShopProductRow,
    ShopProductStatus,
    ShopProductsData,
  } from '../types';
  import { apiGet, apiPost } from '../api';
  import { auth } from '../state/auth.svelte';
  import { SEARCH_DEBOUNCE_MS } from '../state/poll';
  import { localizeAdminError, t } from '../i18n';
  import { fmtCopper, fmtNumber } from '../format';
  import Panel from '../components/Panel.svelte';
  import PageHeader from '../components/PageHeader.svelte';
  import Pager from '../components/Pager.svelte';
  import ModalDialog from '../components/ModalDialog.svelte';

  // Products tab of the shop catalog admin UI (Phase 2 over the Phase 1
  // backend: server/shop_products_routes.ts). List + create (inline form) +
  // edit (modal) + delete (confirm). See ShopCategories.svelte for the sibling
  // this mirrors structurally.

  let list = $state<ShopProductsData | null>(null);
  let failed = $state(false);
  let search = $state('');
  let page = $state(1);
  let statusFilter = $state('');
  let categoryFilter = $state('');
  let sort = $state<'name' | 'createdAt' | 'updatedAt'>('updatedAt');
  let dir = $state<'asc' | 'desc'>('desc');
  let searchTimer: ReturnType<typeof setTimeout> | null = null;

  let categories = $state<ShopCategoryRow[]>([]);

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
      if (categoryFilter) params.set('categoryId', categoryFilter);
      list = await apiGet<ShopProductsData>(`/admin/api/shop/products?${params}`);
      failed = false;
    } catch (err) {
      if (!auth.handleAuthFailure(err)) failed = true;
    }
  }

  async function refreshCategories(): Promise<void> {
    try {
      const params = new URLSearchParams({ page: '1', limit: '100', sort: 'name', dir: 'asc' });
      const res = await apiGet<{ rows: ShopCategoryRow[] }>(`/admin/api/shop/categories?${params}`);
      categories = res.rows;
    } catch (err) {
      if (!auth.handleAuthFailure(err)) window.alert(t('shopProducts.categoriesLoadFailed'));
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
    if (id === null) return t('shopProducts.categoryNone');
    return categories.find((c) => c.id === id)?.name ?? `#${id}`;
  }

  function priceSummary(row: ShopProductRow): string {
    const parts: string[] = [];
    if (row.priceGoldCopper !== null) parts.push(fmtCopper(row.priceGoldCopper));
    if (row.priceClaudium !== null) parts.push(`${fmtNumber(row.priceClaudium)}C`);
    if (row.priceUsdCents !== null) parts.push(`$${(row.priceUsdCents / 100).toFixed(2)}`);
    return parts.length > 0 ? parts.join(' / ') : t('shopProducts.noPrice');
  }

  interface ProductForm {
    sku: string;
    name: string;
    slug: string;
    description: string;
    categoryId: string;
    priceGoldCopper: string;
    priceClaudium: string;
    priceUsdCents: string;
    railSol: boolean;
    railUsdc: boolean;
    railWoc: boolean;
    status: ShopProductStatus;
    featured: boolean;
    grantKind: 'none' | 'weapon_skin' | 'item';
    grantItemId: string;
    grantQuantity: string;
  }

  function emptyForm(): ProductForm {
    return {
      sku: '',
      name: '',
      slug: '',
      description: '',
      categoryId: '',
      priceGoldCopper: '',
      priceClaudium: '',
      priceUsdCents: '',
      railSol: false,
      railUsdc: false,
      railWoc: false,
      status: 'draft',
      featured: false,
      grantKind: 'none',
      grantItemId: '',
      grantQuantity: '',
    };
  }

  function formBody(form: ProductForm) {
    return {
      sku: form.sku.trim(),
      name: form.name.trim(),
      slug: form.slug.trim(),
      description: form.description.trim(),
      categoryId: form.categoryId === '' ? 0 : Number(form.categoryId),
      priceGoldCopper: form.priceGoldCopper.trim(),
      priceClaudium: form.priceClaudium.trim(),
      priceUsdCents: form.priceUsdCents.trim(),
      railSol: form.railSol,
      railUsdc: form.railUsdc,
      railWoc: form.railWoc,
      status: form.status,
      featured: form.featured,
      grantKind: form.grantKind,
      grantItemId: form.grantItemId.trim(),
      grantQuantity: form.grantQuantity.trim(),
    };
  }

  // ---- Create ----
  let createForm = $state(emptyForm());
  let createSaving = $state(false);

  async function submitCreate(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    if (!createForm.sku.trim() || !createForm.name.trim() || !createForm.slug.trim() || createSaving) return;
    createSaving = true;
    try {
      await apiPost('/admin/api/shop/products', formBody(createForm));
      createForm = emptyForm();
      await refresh();
    } catch (err) {
      fail(err, 'shopProducts.saveFailed');
    } finally {
      createSaving = false;
    }
  }

  // ---- Edit ----
  let editing = $state<ShopProductRow | null>(null);
  let editForm = $state(emptyForm());
  let editSaving = $state(false);

  function openEdit(row: ShopProductRow): void {
    editing = row;
    editForm = {
      sku: row.sku,
      name: row.name,
      slug: row.slug,
      description: row.description,
      categoryId: row.categoryId === null ? '' : String(row.categoryId),
      priceGoldCopper: row.priceGoldCopper === null ? '' : String(row.priceGoldCopper),
      priceClaudium: row.priceClaudium === null ? '' : String(row.priceClaudium),
      priceUsdCents: row.priceUsdCents === null ? '' : String(row.priceUsdCents),
      railSol: row.railSol,
      railUsdc: row.railUsdc,
      railWoc: row.railWoc,
      status: row.status,
      featured: row.featured,
      grantKind: row.grantKind,
      grantItemId: row.grantItemId ?? '',
      grantQuantity: String(row.grantQuantity),
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
      await apiPost(`/admin/api/shop/products/${editing.id}`, formBody(editForm));
      editing = null;
      await refresh();
    } catch (err) {
      fail(err, 'shopProducts.saveFailed');
    } finally {
      editSaving = false;
    }
  }

  async function remove(row: ShopProductRow): Promise<void> {
    if (!window.confirm(t('shopProducts.confirmDelete', { name: row.name }))) return;
    try {
      await apiPost(`/admin/api/shop/products/${row.id}/delete`, {});
      await refresh();
    } catch (err) {
      fail(err, 'shopProducts.deleteFailed');
    }
  }

  onMount(() => {
    void refresh();
    void refreshCategories();
    return () => {
      if (searchTimer) clearTimeout(searchTimer);
    };
  });
</script>

{#snippet productFields(form: ProductForm, idPrefix: string)}
  <label>{t('shopProducts.skuLabel')}
    <input placeholder={t('shopProducts.skuPlaceholder')} maxlength="64" bind:value={form.sku} required data-modal-focus={idPrefix === 'edit' ? true : undefined} />
  </label>
  <label>{t('shopProducts.nameLabel')}
    <input placeholder={t('shopProducts.namePlaceholder')} maxlength="120" bind:value={form.name} required />
  </label>
  <label>{t('shopProducts.slugLabel')}
    <input placeholder={t('shopProducts.slugPlaceholder')} maxlength="80" bind:value={form.slug} required />
  </label>
  <label>{t('shopProducts.categoryLabel')}
    <select bind:value={form.categoryId}>
      <option value="">{t('shopProducts.categoryNone')}</option>
      {#each categories as c (c.id)}
        <option value={String(c.id)}>{c.name}</option>
      {/each}
    </select>
  </label>
  <label class="shop-field-wide">{t('shopProducts.descriptionLabel')}
    <input maxlength="2000" bind:value={form.description} />
  </label>
  <label>{t('shopProducts.priceGoldLabel')}
    <input inputmode="numeric" pattern="[0-9]*" bind:value={form.priceGoldCopper} />
  </label>
  <label>{t('shopProducts.priceClaudiumLabel')}
    <input inputmode="numeric" pattern="[0-9]*" bind:value={form.priceClaudium} />
  </label>
  <label>{t('shopProducts.priceUsdLabel')}
    <input inputmode="numeric" pattern="[0-9]*" bind:value={form.priceUsdCents} />
  </label>
  <div class="shop-field-wide shop-hint">{t('shopProducts.priceHint')}</div>
  <label class="shop-checkbox"><input type="checkbox" bind:checked={form.railSol} /> {t('shopProducts.railSolLabel')}</label>
  <label class="shop-checkbox"><input type="checkbox" bind:checked={form.railUsdc} /> {t('shopProducts.railUsdcLabel')}</label>
  <label class="shop-checkbox"><input type="checkbox" bind:checked={form.railWoc} /> {t('shopProducts.railWocLabel')}</label>
  <div class="shop-field-wide shop-hint">{t('shopProducts.railsHint')}</div>
  <label>{t('shopProducts.statusLabel')}
    <select bind:value={form.status}>
      <option value="draft">{t('shopProducts.statusDraft')}</option>
      <option value="active">{t('shopProducts.statusActive')}</option>
      <option value="archived">{t('shopProducts.statusArchived')}</option>
    </select>
  </label>
  <label class="shop-checkbox"><input type="checkbox" bind:checked={form.featured} /> {t('shopProducts.featuredLabel')}</label>
  <div class="shop-field-wide shop-hint">{t('shopProducts.featuredHint')}</div>
  <label>{t('shopProducts.grantKindLabel')}
    <select bind:value={form.grantKind}>
      <option value="none">{t('shopProducts.grantKindNone')}</option>
      <option value="weapon_skin">{t('shopProducts.grantKindWeaponSkin')}</option>
      <option value="item">{t('shopProducts.grantKindItem')}</option>
    </select>
  </label>
  <label>{t('shopProducts.grantItemIdLabel')}
    <input placeholder={t('shopProducts.grantItemIdPlaceholder')} maxlength="64" bind:value={form.grantItemId} disabled={form.grantKind === 'none'} />
  </label>
  <label>{t('shopProducts.grantQuantityLabel')}
    <input inputmode="numeric" pattern="[0-9]*" placeholder="1" bind:value={form.grantQuantity} disabled={form.grantKind !== 'item'} />
  </label>
  <div class="shop-field-wide shop-hint">{t('shopProducts.grantHint')}</div>
{/snippet}

<PageHeader title={t('nav.shopProducts')} />

{#if canManage}
  <Panel title={t('shopProducts.addTitle')}>
    <form class="shop-form" onsubmit={submitCreate}>
      {@render productFields(createForm, 'create')}
      <button disabled={createSaving}>{createSaving ? t('shopCommon.saving') : t('shopProducts.add')}</button>
    </form>
  </Panel>
{/if}

<Panel title={t('shopProducts.listTitle')}>
  <div class="shop-controls">
    <input
      placeholder={t('shopProducts.searchPlaceholder')}
      value={search}
      oninput={onSearchInput}
    />
    <select bind:value={statusFilter} onchange={onFilterChange}>
      <option value="">{t('shopCommon.allStatuses')}</option>
      <option value="draft">{t('shopProducts.statusDraft')}</option>
      <option value="active">{t('shopProducts.statusActive')}</option>
      <option value="archived">{t('shopProducts.statusArchived')}</option>
    </select>
    <select bind:value={categoryFilter} onchange={onFilterChange}>
      <option value="">{t('shopProducts.filterAllCategories')}</option>
      <option value="0">{t('shopProducts.filterUncategorized')}</option>
      {#each categories as c (c.id)}
        <option value={String(c.id)}>{c.name}</option>
      {/each}
    </select>
    <select bind:value={sort} onchange={onFilterChange}>
      <option value="updatedAt">{t('shopProducts.sortLabel')}: {t('shopProducts.sortUpdated')}</option>
      <option value="name">{t('shopProducts.sortLabel')}: {t('shopProducts.sortName')}</option>
      <option value="createdAt">{t('shopProducts.sortLabel')}: {t('shopProducts.sortCreated')}</option>
    </select>
    {#if list}
      <div class="pager">
        <Pager total={list.total} page={list.page} limit={list.limit} onPage={(p) => { page = p; void refresh(); }} />
      </div>
    {/if}
  </div>

  {#if failed}
    <div class="empty">{t('shopProducts.loadFailed')}</div>
  {:else if list && list.rows.length === 0}
    <div class="empty">{t('shopProducts.empty')}</div>
  {:else if list}
    <table>
      <thead>
        <tr>
          <th class="num">{t('shopProducts.colId')}</th>
          <th>{t('shopProducts.colSku')}</th>
          <th>{t('shopProducts.colName')}</th>
          <th>{t('shopProducts.colCategory')}</th>
          <th>{t('shopProducts.colPrice')}</th>
          <th>{t('shopProducts.colStatus')}</th>
          <th>{t('shopProducts.colFeatured')}</th>
          <th>{t('shopProducts.colGrant')}</th>
          {#if canManage}<th>{t('shopCommon.colActions')}</th>{/if}
        </tr>
      </thead>
      <tbody>
        {#each list.rows as row (row.id)}
          <tr>
            <td class="num">{row.id}</td>
            <td>{row.sku}</td>
            <td>{row.name}</td>
            <td>{categoryName(row.categoryId)}</td>
            <td>{priceSummary(row)}</td>
            <td>
              {#if row.status === 'draft'}{t('shopProducts.statusDraft')}
              {:else if row.status === 'active'}{t('shopProducts.statusActive')}
              {:else}{t('shopProducts.statusArchived')}{/if}
            </td>
            <td>{row.featured ? t('shopCommon.yes') : t('shopCommon.no')}</td>
            <td>
              {#if row.grantKind === 'weapon_skin'}{t('shopProducts.grantKindWeaponSkin')}
              {:else if row.grantKind === 'item'}{t('shopProducts.grantKindItem')}
              {:else}{t('shopProducts.grantKindNone')}{/if}
            </td>
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
  <ModalDialog labelledBy="shop-product-edit-title" closeLabel={t('shopCommon.close')} width="700px" onClose={closeEdit}>
    <div class="shop-modal-content">
      <h2 id="shop-product-edit-title">{t('shopProducts.editTitle')}</h2>
      <form class="shop-form" onsubmit={submitEdit}>
        {@render productFields(editForm, 'edit')}
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
