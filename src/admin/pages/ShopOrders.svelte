<script lang="ts">
  import { onMount } from 'svelte';
  import type { ShopOrderCurrency, ShopOrderRow, ShopOrdersData, ShopProductRow } from '../types';
  import { apiGet, apiPost } from '../api';
  import { auth } from '../state/auth.svelte';
  import { SEARCH_DEBOUNCE_MS } from '../state/poll';
  import { getAdminNavigation, routeHref } from '../navigation';
  import { localizeAdminError, t } from '../i18n';
  import { fmtCopper, fmtDate, fmtNumber } from '../format';
  import Panel from '../components/Panel.svelte';
  import PageHeader from '../components/PageHeader.svelte';
  import Pager from '../components/Pager.svelte';
  import Badge from '../components/Badge.svelte';
  import OrderStatusBadge from '../components/OrderStatusBadge.svelte';

  // Orders tab of the shop admin UI (Phase 3: server/shop_orders_routes.ts).
  // List + search/filter/sort/pagination, plus a compact back-office "new
  // order" form (there is no customer storefront yet, see SHOP_SYSTEM.md: an
  // order can currently only be entered here). Row id links to the detail
  // page (ShopOrderDetail.svelte) for status management and the timeline.

  const navigation = getAdminNavigation();

  let list = $state<ShopOrdersData | null>(null);
  let failed = $state(false);
  let search = $state('');
  let page = $state(1);
  let statusFilter = $state('');
  let accountFilter = $state('');
  let sort = $state<'createdAt' | 'updatedAt' | 'totalAmount'>('createdAt');
  let dir = $state<'asc' | 'desc'>('desc');
  let searchTimer: ReturnType<typeof setTimeout> | null = null;

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
      if (statusFilter) params.set('status', statusFilter);
      if (accountFilter) params.set('accountId', accountFilter);
      list = await apiGet<ShopOrdersData>(`/admin/api/shop/orders?${params}`);
      failed = false;
    } catch (err) {
      if (!auth.handleAuthFailure(err)) failed = true;
    }
  }

  async function refreshProducts(): Promise<void> {
    try {
      const params = new URLSearchParams({
        page: '1',
        limit: '100',
        status: 'active',
        sort: 'name',
        dir: 'asc',
      });
      const res = await apiGet<{ rows: ShopProductRow[] }>(`/admin/api/shop/products?${params}`);
      products = res.rows;
    } catch (err) {
      if (!auth.handleAuthFailure(err)) window.alert(t('shopOrders.productsLoadFailed'));
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

  function amountSummary(row: ShopOrderRow): string {
    if (row.currency === 'gold') return fmtCopper(row.totalAmount);
    if (row.currency === 'claudium') return `${fmtNumber(row.totalAmount)}C`;
    return `$${(row.totalAmount / 100).toFixed(2)}`;
  }

  // ---- Create (back-office order entry) ----
  interface ItemDraft {
    productId: string;
    quantity: string;
  }

  let newAccountId = $state('');
  let newCurrency = $state<ShopOrderCurrency>('gold');
  let newNote = $state('');
  let newItems = $state<ItemDraft[]>([{ productId: '', quantity: '1' }]);
  let createSaving = $state(false);

  function addItemRow(): void {
    newItems = [...newItems, { productId: '', quantity: '1' }];
  }

  function removeItemRow(index: number): void {
    newItems = newItems.filter((_, i) => i !== index);
  }

  function resetCreateForm(): void {
    newAccountId = '';
    newCurrency = 'gold';
    newNote = '';
    newItems = [{ productId: '', quantity: '1' }];
  }

  async function submitCreate(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    if (createSaving) return;
    const accountId = Number(newAccountId);
    const items = newItems
      .filter((i) => i.productId !== '')
      .map((i) => ({ productId: Number(i.productId), quantity: Math.max(1, Number(i.quantity) || 1) }));
    if (!Number.isInteger(accountId) || accountId < 1 || items.length === 0) return;
    createSaving = true;
    try {
      const order = await apiPost<{ id: number }>('/admin/api/shop/orders', {
        accountId,
        currency: newCurrency,
        items,
        note: newNote.trim(),
      });
      resetCreateForm();
      await refresh();
      const event = new MouseEvent('click');
      navigation?.navigate(event, { page: 'shop-order-detail', id: order.id });
    } catch (err) {
      fail(err, 'shopOrders.createFailed');
    } finally {
      createSaving = false;
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

<PageHeader title={t('nav.shopOrders')} />

{#if canManage}
  <Panel title={t('shopOrders.newTitle')} hint={t('shopOrders.newHint')}>
    <form class="order-form" onsubmit={submitCreate}>
      <label>{t('shopOrders.accountIdLabel')}
        <input inputmode="numeric" pattern="[0-9]*" bind:value={newAccountId} required />
      </label>
      <label>{t('shopOrders.currencyLabel')}
        <select bind:value={newCurrency}>
          <option value="gold">{t('shopOrders.currencyGold')}</option>
          <option value="claudium">{t('shopOrders.currencyClaudium')}</option>
          <option value="usd">{t('shopOrders.currencyUsd')}</option>
        </select>
      </label>
      <label class="order-field-wide">{t('shopOrders.noteLabel')}
        <input maxlength="500" bind:value={newNote} />
      </label>

      <div class="order-field-wide order-items">
        <div class="order-items-label">{t('shopOrders.itemsLabel')}</div>
        {#each newItems as item, index (index)}
          <div class="order-item-row">
            <select bind:value={item.productId} required aria-label={t('shopOrders.selectProduct')}>
              <option value="">{t('shopOrders.selectProduct')}</option>
              {#each products as p (p.id)}
                <option value={String(p.id)}>{p.name} ({p.sku})</option>
              {/each}
            </select>
            <input
              class="order-item-qty"
              inputmode="numeric"
              pattern="[0-9]*"
              bind:value={item.quantity}
              aria-label={t('shopOrders.quantityLabel')}
            />
            <button
              type="button"
              class="order-item-remove"
              disabled={newItems.length <= 1}
              onclick={() => removeItemRow(index)}
            >{t('shopCommon.remove')}</button>
          </div>
        {/each}
        <button type="button" onclick={addItemRow}>{t('shopOrders.addItem')}</button>
      </div>

      <button disabled={createSaving}>{createSaving ? t('shopCommon.saving') : t('shopOrders.create')}</button>
    </form>
  </Panel>
{/if}

<Panel title={t('shopOrders.listTitle')}>
  <div class="shop-controls">
    <input
      placeholder={t('shopOrders.searchPlaceholder')}
      value={search}
      oninput={onSearchInput}
    />
    <select bind:value={statusFilter} onchange={onFilterChange}>
      <option value="">{t('shopCommon.allStatuses')}</option>
      <option value="pending">{t('shopOrders.statusPending')}</option>
      <option value="paid">{t('shopOrders.statusPaid')}</option>
      <option value="fulfilled">{t('shopOrders.statusFulfilled')}</option>
      <option value="cancelled">{t('shopOrders.statusCancelled')}</option>
      <option value="refunded">{t('shopOrders.statusRefunded')}</option>
    </select>
    <input
      class="account-filter"
      placeholder={t('shopOrders.filterAccountId')}
      inputmode="numeric"
      pattern="[0-9]*"
      bind:value={accountFilter}
      onchange={onFilterChange}
    />
    <select bind:value={sort} onchange={onFilterChange}>
      <option value="createdAt">{t('shopOrders.sortLabel')}: {t('shopOrders.sortCreated')}</option>
      <option value="updatedAt">{t('shopOrders.sortLabel')}: {t('shopOrders.sortUpdated')}</option>
      <option value="totalAmount">{t('shopOrders.sortLabel')}: {t('shopOrders.sortTotal')}</option>
    </select>
    {#if list}
      <div class="pager">
        <Pager total={list.total} page={list.page} limit={list.limit} onPage={(p) => { page = p; void refresh(); }} />
      </div>
    {/if}
  </div>

  {#if failed}
    <div class="empty">{t('shopOrders.loadFailed')}</div>
  {:else if list && list.rows.length === 0}
    <div class="empty">{t('shopOrders.empty')}</div>
  {:else if list}
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th class="num">{t('shopOrders.colId')}</th>
            <th>{t('shopOrders.colAccount')}</th>
            <th>{t('shopOrders.colStatus')}</th>
            <th>{t('shopOrders.colTotal')}</th>
            <th>{t('shopOrders.colNote')}</th>
            <th>{t('shopOrders.colCreatedAt')}</th>
          </tr>
        </thead>
        <tbody>
          {#each list.rows as row (row.id)}
            <tr>
              <td class="num">
                <a
                  href={routeHref({ page: 'shop-order-detail', id: row.id })}
                  onclick={(event) => navigation?.navigate(event, { page: 'shop-order-detail', id: row.id })}
                >#{row.id}</a>
              </td>
              <td>{row.accountUsername} <span class="hint">#{row.accountId}</span></td>
              <td><OrderStatusBadge status={row.status} /></td>
              <td>{amountSummary(row)}</td>
              <td class="note-cell">{row.note}</td>
              <td>{fmtDate(row.createdAt)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</Panel>

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

  .account-filter {
    width: 120px;
  }

  .order-form {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 10px 14px;
    align-items: end;
  }

  .order-form label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 12px;
    color: var(--text-dim);
  }

  .order-field-wide {
    grid-column: 1 / -1;
  }

  .order-items {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .order-items-label {
    font-size: 12px;
    color: var(--text-dim);
  }

  .order-item-row {
    display: flex;
    gap: 8px;
    align-items: center;
  }

  .order-item-row select {
    flex: 1;
    min-width: 0;
  }

  .order-item-qty {
    width: 80px;
  }

  .hint {
    color: var(--text-dim);
    font-size: var(--font-size-small);
  }

  .note-cell {
    max-width: 220px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .table-scroll {
    overflow-x: auto;
  }
</style>
