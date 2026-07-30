<script lang="ts">
  import { onMount } from 'svelte';
  import type { ShopOrderDetailData, ShopOrderStatus } from '../types';
  import { apiGet, apiPost } from '../api';
  import { auth } from '../state/auth.svelte';
  import { getAdminNavigation, routeHref } from '../navigation';
  import { localizeAdminError, t } from '../i18n';
  import { fmtCopper, fmtDate, fmtNumber } from '../format';
  import Panel from '../components/Panel.svelte';
  import PageHeader from '../components/PageHeader.svelte';
  import OrderStatusBadge from '../components/OrderStatusBadge.svelte';

  // Order Details page (Phase 3): status management, line items, and the
  // status-history timeline. Reached only from the Orders list row link
  // (ShopOrders.svelte) or a direct ?page=shop-order-detail&id= URL; not in
  // the nav tree, the same shape as IpAssociations.svelte.

  let { id }: { id: number } = $props();

  const navigation = getAdminNavigation();

  let order = $state<ShopOrderDetailData | null>(null);
  let failed = $state(false);
  let actionNote = $state('');
  let actionPending = $state(false);
  let requestId = 0;

  let canManage = $derived(auth.can('shop.manage'));

  interface NextAction {
    labelKey: string;
    run: (note: string) => Promise<ShopOrderDetailData>;
  }

  // Mirrors server/shop_orders.ts's transitionEffect table for PRESENTATION
  // only (which buttons to show); the server is the sole authority and
  // re-validates every transition regardless of what this offers.
  function nextActions(status: ShopOrderStatus): NextAction[] {
    if (status === 'pending') {
      return [
        {
          labelKey: 'shopOrders.actionMarkPaid',
          run: (note) => apiPost(`/admin/api/shop/orders/${id}/status`, { status: 'paid', note }),
        },
        {
          labelKey: 'shopOrders.actionCancel',
          run: (note) => apiPost(`/admin/api/shop/orders/${id}/cancel`, { note }),
        },
      ];
    }
    if (status === 'paid') {
      return [
        {
          labelKey: 'shopOrders.actionMarkFulfilled',
          run: (note) =>
            apiPost(`/admin/api/shop/orders/${id}/status`, { status: 'fulfilled', note }),
        },
        {
          labelKey: 'shopOrders.actionCancel',
          run: (note) => apiPost(`/admin/api/shop/orders/${id}/cancel`, { note }),
        },
        {
          labelKey: 'shopOrders.actionRefund',
          run: (note) => apiPost(`/admin/api/shop/orders/${id}/refund`, { note }),
        },
      ];
    }
    if (status === 'fulfilled') {
      return [
        {
          labelKey: 'shopOrders.actionRefund',
          run: (note) => apiPost(`/admin/api/shop/orders/${id}/refund`, { note }),
        },
      ];
    }
    return [];
  }

  async function refresh(): Promise<void> {
    const currentRequest = ++requestId;
    try {
      const result = await apiGet<ShopOrderDetailData>(`/admin/api/shop/orders/${id}`);
      if (currentRequest !== requestId) return;
      order = result;
      failed = false;
    } catch (err) {
      if (currentRequest !== requestId) return;
      if (!auth.handleAuthFailure(err)) failed = true;
    }
  }

  function amountSummary(amount: number, currency: ShopOrderDetailData['currency']): string {
    if (currency === 'gold') return fmtCopper(amount);
    if (currency === 'claudium') return `${fmtNumber(amount)}C`;
    return `$${(amount / 100).toFixed(2)}`;
  }

  async function runAction(action: NextAction): Promise<void> {
    if (actionPending) return;
    actionPending = true;
    try {
      await action.run(actionNote.trim());
      actionNote = '';
      await refresh();
    } catch (err) {
      if (!auth.handleAuthFailure(err)) {
        window.alert(err instanceof Error ? localizeAdminError(err.message) : t('shopOrders.actionFailed'));
      }
    } finally {
      actionPending = false;
    }
  }

  function back(event: MouseEvent): void {
    navigation?.back(event);
  }

  // 'pending' -> 'Pending' so it maps to the shopOrders.status<Suffix> key family
  // OrderStatusBadge also uses (kept as a plain string transform rather than a
  // second status->key table, since the two must always agree).
  function statusSuffix(status: ShopOrderStatus): string {
    return status.charAt(0).toUpperCase() + status.slice(1);
  }

  onMount(() => {
    void refresh();
  });
</script>

<div class="order-detail-page">
  <PageHeader title={t('shopOrders.detailTitle', { id: String(id) })} />

  <a class="back-link" href={routeHref({ page: 'shop-orders' })} onclick={back}>{t('shopOrders.back')}</a>

  {#if failed}
    <Panel><div class="empty">{t('shopOrders.loadFailed')}</div></Panel>
  {:else if order === null}
    <Panel><div class="empty">{t('shopOrders.loading')}</div></Panel>
  {:else}
    <Panel title={t('shopOrders.summaryTitle')}>
      <div class="summary-grid">
        <div><span class="label">{t('shopOrders.colStatus')}</span><OrderStatusBadge status={order.status} /></div>
        <div><span class="label">{t('shopOrders.accountIdLabel')}</span>{order.accountUsername} <span class="hint">#{order.accountId}</span></div>
        <div><span class="label">{t('shopOrders.colTotal')}</span>{amountSummary(order.totalAmount, order.currency)}</div>
        <div><span class="label">{t('shopOrders.currencyLabel')}</span>{order.currency}</div>
        <div><span class="label">{t('shopOrders.colCreatedAt')}</span>{fmtDate(order.createdAt)}</div>
        <div><span class="label">{t('shopOrders.updatedAtLabel')}</span>{fmtDate(order.updatedAt)}</div>
        {#if order.createdByAdminId !== null}
          <div><span class="label">{t('shopOrders.createdByLabel')}</span>#{order.createdByAdminId}</div>
        {/if}
        {#if order.note}
          <div class="note-block"><span class="label">{t('shopOrders.noteLabel')}</span>{order.note}</div>
        {/if}
      </div>

      {#if canManage && nextActions(order.status).length > 0}
        <div class="actions-block">
          <label class="note-input">{t('shopOrders.actionNoteLabel')}
            <input maxlength="500" bind:value={actionNote} />
          </label>
          <div class="action-buttons">
            {#each nextActions(order.status) as action (action.labelKey)}
              <button type="button" disabled={actionPending} onclick={() => void runAction(action)}>
                {t(action.labelKey)}
              </button>
            {/each}
          </div>
        </div>
      {/if}
    </Panel>

    <Panel title={t('shopOrders.itemsTitle')}>
      <div class="table-scroll">
        <table>
          <thead>
            <tr>
              <th>{t('shopOrders.colProduct')}</th>
              <th>{t('shopOrders.colSku')}</th>
              <th class="num">{t('shopOrders.colUnitPrice')}</th>
              <th class="num">{t('shopOrders.colQuantity')}</th>
              <th class="num">{t('shopOrders.colLineTotal')}</th>
            </tr>
          </thead>
          <tbody>
            {#each order.items as item (item.id)}
              <tr>
                <td>{item.productName}{#if item.productId === null} <span class="hint">{t('shopOrders.productDeleted')}</span>{/if}</td>
                <td>{item.productSku}</td>
                <td class="num">{amountSummary(item.unitPrice, order.currency)}</td>
                <td class="num">{fmtNumber(item.quantity)}</td>
                <td class="num">{amountSummary(item.lineTotal, order.currency)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </Panel>

    <Panel title={t('shopOrders.timelineTitle')}>
      {#if order.history.length === 0}
        <div class="empty">{t('shopOrders.timelineEmpty')}</div>
      {:else}
        <ol class="timeline">
          {#each order.history as entry (entry.id)}
            <li>
              <div class="timeline-row">
                {#if entry.fromStatus === null}
                  <span>{t('shopOrders.timelineCreated', { status: t(`shopOrders.status${statusSuffix(entry.toStatus)}`) })}</span>
                {:else}
                  <span>
                    {t('shopOrders.timelineTransition', {
                      from: t(`shopOrders.status${statusSuffix(entry.fromStatus)}`),
                      to: t(`shopOrders.status${statusSuffix(entry.toStatus)}`),
                    })}
                  </span>
                {/if}
                <span class="hint">{fmtDate(entry.createdAt)}</span>
              </div>
              {#if entry.adminAccountId !== null}
                <div class="hint">{t('shopOrders.timelineBy', { id: String(entry.adminAccountId) })}</div>
              {/if}
              {#if entry.note}
                <div class="timeline-note">{entry.note}</div>
              {/if}
            </li>
          {/each}
        </ol>
      {/if}
    </Panel>
  {/if}
</div>

<style>
  .order-detail-page {
    display: grid;
    gap: 10px;
  }

  .back-link {
    display: inline-flex;
    align-items: center;
    width: fit-content;
  }

  .back-link:focus-visible {
    outline: 2px solid var(--gold);
    outline-offset: 2px;
  }

  .summary-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 10px 16px;
    margin-bottom: 12px;
  }

  .summary-grid .label {
    display: block;
    font-size: 12px;
    color: var(--text-dim);
  }

  .note-block {
    grid-column: 1 / -1;
  }

  .hint {
    color: var(--text-dim);
    font-size: var(--font-size-small);
  }

  .actions-block {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: 12px;
    padding-top: 10px;
    border-top: 1px solid var(--border-subtle);
  }

  .note-input {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 12px;
    color: var(--text-dim);
    flex: 1;
    min-width: 200px;
  }

  .action-buttons {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .table-scroll {
    overflow-x: auto;
  }

  .timeline {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 10px;
  }

  .timeline li {
    padding: 8px 10px;
    background: var(--surface-sunken);
    border: 1px solid var(--border-subtle);
    border-radius: 4px;
  }

  .timeline-row {
    display: flex;
    justify-content: space-between;
    gap: 10px;
    flex-wrap: wrap;
  }

  .timeline-note {
    margin-top: 4px;
    font-size: var(--font-size-small);
  }
</style>
