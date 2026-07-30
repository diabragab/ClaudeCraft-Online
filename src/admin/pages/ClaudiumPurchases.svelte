<script lang="ts">
  import { onMount } from 'svelte';
  import type { ClaudiumPurchaseRow, ClaudiumPurchasesData, ClaudiumPurchaseStatus } from '../types';
  import { apiGet } from '../api';
  import { auth } from '../state/auth.svelte';
  import { t } from '../i18n';
  import { fmtDate, fmtNumber } from '../format';
  import Panel from '../components/Panel.svelte';
  import PageHeader from '../components/PageHeader.svelte';
  import Pager from '../components/Pager.svelte';
  import ClaudiumPurchaseStatusBadge from '../components/ClaudiumPurchaseStatusBadge.svelte';

  // Payment history / audit log for Claudium Package purchases (Phase 8,
  // server/claudium_purchases_routes.ts listPurchasesHandler). Read-only: a
  // purchase is only ever created by the checkout route and only ever
  // transitioned by the Stripe webhook, never entered or edited here.

  let list = $state<ClaudiumPurchasesData | null>(null);
  let failed = $state(false);
  let page = $state(1);
  let statusFilter = $state('');
  let accountFilter = $state('');
  let sort = $state<'createdAt' | 'updatedAt'>('createdAt');
  let dir = $state<'asc' | 'desc'>('desc');

  async function refresh(): Promise<void> {
    try {
      const params = new URLSearchParams({ page: String(page), limit: '20', sort, dir });
      if (statusFilter) params.set('status', statusFilter);
      if (accountFilter) params.set('accountId', accountFilter);
      list = await apiGet<ClaudiumPurchasesData>(`/admin/api/shop/claudium/purchases?${params}`);
      failed = false;
    } catch (err) {
      if (!auth.handleAuthFailure(err)) failed = true;
    }
  }

  function onFilterChange(): void {
    page = 1;
    void refresh();
  }

  function amountSummary(row: ClaudiumPurchaseRow): string {
    return `$${(row.amountTotal / 100).toFixed(2)} ${row.currency}`;
  }

  function claudiumSummary(row: ClaudiumPurchaseRow): string {
    const total = row.claudiumAmount + row.bonusAmount;
    return row.bonusAmount > 0
      ? `${fmtNumber(total)} (${fmtNumber(row.claudiumAmount)}+${fmtNumber(row.bonusAmount)})`
      : fmtNumber(total);
  }

  onMount(() => {
    void refresh();
  });
</script>

<PageHeader title={t('nav.claudiumPurchases')} />

<Panel title={t('claudiumPurchases.listTitle')}>
  <div class="purchase-controls">
    <select bind:value={statusFilter} onchange={onFilterChange}>
      <option value="">{t('shopCommon.allStatuses')}</option>
      {#each (['pending', 'paid', 'failed', 'expired', 'refunded'] satisfies ClaudiumPurchaseStatus[]) as s (s)}
        <option value={s}>{t(`claudiumPurchases.status${s.charAt(0).toUpperCase()}${s.slice(1)}`)}</option>
      {/each}
    </select>
    <input
      class="account-filter"
      placeholder={t('claudiumPurchases.filterAccountId')}
      inputmode="numeric"
      pattern="[0-9]*"
      bind:value={accountFilter}
      onchange={onFilterChange}
    />
    <select bind:value={sort} onchange={onFilterChange}>
      <option value="createdAt">{t('claudiumPurchases.sortLabel')}: {t('claudiumPurchases.sortCreated')}</option>
      <option value="updatedAt">{t('claudiumPurchases.sortLabel')}: {t('claudiumPurchases.sortUpdated')}</option>
    </select>
    {#if list}
      <div class="pager">
        <Pager total={list.total} page={list.page} limit={list.limit} onPage={(p) => { page = p; void refresh(); }} />
      </div>
    {/if}
  </div>

  {#if failed}
    <div class="empty">{t('claudiumPurchases.loadFailed')}</div>
  {:else if list && list.rows.length === 0}
    <div class="empty">{t('claudiumPurchases.empty')}</div>
  {:else if list}
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th class="num">{t('claudiumPurchases.colId')}</th>
            <th>{t('claudiumPurchases.colAccount')}</th>
            <th>{t('claudiumPurchases.colPackage')}</th>
            <th>{t('claudiumPurchases.colClaudium')}</th>
            <th>{t('claudiumPurchases.colAmount')}</th>
            <th>{t('claudiumPurchases.colStatus')}</th>
            <th>{t('claudiumPurchases.colSession')}</th>
            <th>{t('claudiumPurchases.colCreatedAt')}</th>
          </tr>
        </thead>
        <tbody>
          {#each list.rows as row (row.id)}
            <tr>
              <td class="num">#{row.id}</td>
              <td>{row.accountUsername} <span class="hint">#{row.accountId}</span></td>
              <td>{row.packageName}</td>
              <td>{claudiumSummary(row)}</td>
              <td>{amountSummary(row)}</td>
              <td><ClaudiumPurchaseStatusBadge status={row.status} /></td>
              <td class="session-cell"><code>{row.stripeSessionId}</code></td>
              <td>{fmtDate(row.createdAt)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</Panel>

<style>
  .purchase-controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
    margin-bottom: 14px;
  }

  .purchase-controls .pager {
    margin-left: auto;
  }

  .account-filter {
    width: 120px;
  }

  .hint {
    color: var(--text-dim);
    font-size: var(--font-size-small);
  }

  .session-cell {
    max-width: 180px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--font-size-small);
  }

  .table-scroll {
    overflow-x: auto;
  }
</style>
