// Order detail page: summary, items, and status-history timeline for one of
// the authenticated player's own orders (GET /api/shop/orders/:id, ownership-
// checked server-side via requireOwned; a mismatched or missing order both
// answer the same 404, so this page's error state covers both cases).

import { esc } from '../../ui/esc';
import { t } from '../../ui/i18n';
import { formatDate, errorHtml, loadingHtml, orderStatusLabel } from '../dom';
import { getSession } from '../api';
import { formatPrice } from '../format';
import type { StorePage, StorePageContext } from '../page';
import { hrefFor } from '../routes';
import { getMyOrder } from '../shop_api';
import type { StoreOrderDetail } from '../types';

const CONTENT_ID = 'store-order-detail-content';
const RETRY_ID = 'store-order-detail-retry';

function itemRowHtml(item: StoreOrderDetail['items'][number], currency: StoreOrderDetail['currency']): string {
  return `<tr>
    <td>${esc(item.productName)}</td>
    <td class="num">${esc(formatPrice(item.unitPrice, currency))}</td>
    <td class="num">${item.quantity}</td>
    <td class="num">${esc(formatPrice(item.lineTotal, currency))}</td>
  </tr>`;
}

function timelineEntryHtml(entry: StoreOrderDetail['history'][number]): string {
  const label =
    entry.fromStatus === null
      ? t('store.orderDetail.timelineCreated', { status: orderStatusLabel(entry.toStatus) })
      : t('store.orderDetail.timelineTransition', {
          from: orderStatusLabel(entry.fromStatus),
          to: orderStatusLabel(entry.toStatus),
        });
  return `<li>
    <div>${esc(label)}</div>
    <div class="store-hint">${esc(formatDate(entry.createdAt))}</div>
    ${entry.note ? `<div class="store-timeline-note">${esc(entry.note)}</div>` : ''}
  </li>`;
}

function renderOrder(order: StoreOrderDetail): string {
  return `
    <h1>${esc(t('store.orderDetail.title', { id: String(order.id) }))}</h1>
    <section>
      <h2>${esc(t('store.orderDetail.summaryTitle'))}</h2>
      <dl class="store-summary-grid">
        <div><dt>${esc(t('store.orderDetail.statusLabel'))}</dt><dd>${esc(orderStatusLabel(order.status))}</dd></div>
        <div><dt>${esc(t('store.checkout.totalLabel'))}</dt><dd>${esc(formatPrice(order.totalAmount, order.currency))}</dd></div>
        <div><dt>${esc(t('store.orderDetail.placedLabel'))}</dt><dd>${esc(formatDate(order.createdAt))}</dd></div>
        <div><dt>${esc(t('store.orderDetail.updatedLabel'))}</dt><dd>${esc(formatDate(order.updatedAt))}</dd></div>
        ${order.note ? `<div class="store-summary-note"><dt>${esc(t('store.orderDetail.noteLabel'))}</dt><dd>${esc(order.note)}</dd></div>` : ''}
      </dl>
    </section>
    <section>
      <h2>${esc(t('store.orderDetail.itemsTitle'))}</h2>
      <div class="store-table-scroll">
        <table>
          <thead><tr>
            <th>${esc(t('store.orderDetail.colProduct'))}</th>
            <th class="num">${esc(t('store.orderDetail.colUnitPrice'))}</th>
            <th class="num">${esc(t('store.orderDetail.colQuantity'))}</th>
            <th class="num">${esc(t('store.orderDetail.colLineTotal'))}</th>
          </tr></thead>
          <tbody>${order.items.map((i) => itemRowHtml(i, order.currency)).join('')}</tbody>
        </table>
      </div>
    </section>
    <section>
      <h2>${esc(t('store.orderDetail.timelineTitle'))}</h2>
      <ol class="store-timeline">${order.history.map(timelineEntryHtml).join('')}</ol>
    </section>
  `;
}

async function loadContent(root: HTMLElement, id: number): Promise<void> {
  const slot = root.querySelector(`#${CONTENT_ID}`);
  if (!slot) return;
  try {
    const order = await getMyOrder(id);
    slot.innerHTML = renderOrder(order);
  } catch {
    slot.innerHTML = `<div class="store-state">${t('store.orderDetail.notFound')}</div>` + errorHtml(RETRY_ID);
    slot.querySelector(`#${RETRY_ID}`)?.addEventListener('click', () => void loadContent(root, id));
  }
}

export const orderDetailPage: StorePage = {
  render(ctx: StorePageContext) {
    if (!getSession()) {
      return `<div class="store-state">
        <h1>${esc(t('store.orders.title'))}</h1>
        <p>${esc(t('store.orders.signInRequiredBody'))}</p>
        <a href="/">${esc(t('store.checkout.signInLink'))}</a>
      </div>`;
    }
    void ctx;
    return `<a class="store-back-link" href="${esc(hrefFor('orders'))}">${esc(t('store.common.back'))}</a><div id="${CONTENT_ID}">${loadingHtml()}</div>`;
  },
  mount(root: HTMLElement, ctx: StorePageContext) {
    if (!getSession() || !ctx.param) return;
    const id = Number(ctx.param);
    if (!Number.isInteger(id)) return;
    void loadContent(root, id);
  },
};
