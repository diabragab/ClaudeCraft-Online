// Order history page: the authenticated player's own orders
// (GET /api/shop/orders, server/shop_storefront_orders_routes.ts, always
// scoped to the caller's own accountId server-side).

import { esc } from '../../ui/esc';
import { t } from '../../ui/i18n';
import { formatDate, emptyHtml, errorHtml, loadingHtml, orderStatusLabel } from '../dom';
import { getSession } from '../api';
import { formatPrice } from '../format';
import type { StorePage } from '../page';
import { hrefFor } from '../routes';
import { listMyOrders } from '../shop_api';
import type { StoreOrderDetail } from '../types';

const CONTENT_ID = 'store-orders-content';
const RETRY_ID = 'store-orders-retry';

function rowHtml(order: StoreOrderDetail): string {
  return `<tr>
    <td><a href="${esc(hrefFor(`orders/${order.id}`))}">#${order.id}</a></td>
    <td>${esc(orderStatusLabel(order.status))}</td>
    <td class="num">${esc(formatPrice(order.totalAmount, order.currency))}</td>
    <td>${esc(formatDate(order.createdAt))}</td>
  </tr>`;
}

function renderSignInRequired(): string {
  return `<div class="store-state">
    <h1>${esc(t('store.orders.title'))}</h1>
    <p>${esc(t('store.orders.signInRequiredBody'))}</p>
    <a href="/">${esc(t('store.checkout.signInLink'))}</a>
  </div>`;
}

async function loadContent(root: HTMLElement): Promise<void> {
  const slot = root.querySelector(`#${CONTENT_ID}`);
  if (!slot) return;
  try {
    const result = await listMyOrders({ limit: 50 });
    slot.innerHTML =
      result.rows.length > 0
        ? `<div class="store-table-scroll"><table>
            <thead><tr>
              <th>${esc(t('store.orders.colId'))}</th>
              <th>${esc(t('store.orders.colStatus'))}</th>
              <th class="num">${esc(t('store.orders.colTotal'))}</th>
              <th>${esc(t('store.orders.colDate'))}</th>
            </tr></thead>
            <tbody>${result.rows.map(rowHtml).join('')}</tbody>
          </table></div>`
        : emptyHtml(t('store.orders.empty'));
  } catch {
    slot.innerHTML = errorHtml(RETRY_ID);
    slot.querySelector(`#${RETRY_ID}`)?.addEventListener('click', () => void loadContent(root));
  }
}

export const ordersPage: StorePage = {
  render() {
    if (!getSession()) return renderSignInRequired();
    return `<h1>${esc(t('store.orders.title'))}</h1><div id="${CONTENT_ID}">${loadingHtml()}</div>`;
  },
  mount(root: HTMLElement) {
    if (!getSession()) return;
    void loadContent(root);
  },
};
