// Shared render helpers for the storefront pages: loading/error/empty state
// snippets, the reusable product-card grid cell, and pagination controls.
// Kept as one small sibling module (module-first) rather than duplicated
// per-page markup, since every listing page (home's featured/new sections,
// categories, product search) renders the same card shape.

import { formatDateTime, t } from '../ui/i18n';
import { esc } from '../ui/esc';
import { availabilityLabel, formatPrice, isPurchasable } from './format';
import { hrefFor } from './routes';
import type { StoreOrderStatus, StoreProduct } from './types';

export const LOADING_ID = 'store-loading-slot';

export function loadingHtml(): string {
  return `<div id="${LOADING_ID}" class="store-state store-loading" role="status">${esc(t('store.common.loading'))}</div>`;
}

export function errorHtml(retryId: string): string {
  return `<div class="store-state store-error" role="alert">
    <p>${esc(t('store.common.error'))}</p>
    <button type="button" id="${esc(retryId)}">${esc(t('store.common.retry'))}</button>
  </div>`;
}

export function emptyHtml(message: string): string {
  return `<div class="store-state store-empty">${esc(message)}</div>`;
}

/** A single product grid cell: image-free card with name, price, availability. */
export function productCardHtml(product: StoreProduct): string {
  const price =
    product.priceGoldCopper !== null
      ? formatPrice(product.priceGoldCopper, 'gold')
      : product.priceClaudium !== null
        ? formatPrice(product.priceClaudium, 'claudium')
        : product.priceUsdCents !== null
          ? formatPrice(product.priceUsdCents, 'usd')
          : '';
  const purchasable = isPurchasable(product.availability);
  return `<a class="store-card" href="${esc(hrefFor(`products/${product.slug}`))}">
    <div class="store-card-body">
      <h3 class="store-card-title">${esc(product.name)}</h3>
      <div class="store-card-price">${esc(price)}</div>
      <div class="store-card-availability${purchasable ? '' : ' store-unavailable'}">${esc(availabilityLabel(product.availability))}</div>
    </div>
  </a>`;
}

export function productGridHtml(products: StoreProduct[]): string {
  return `<div class="store-grid">${products.map(productCardHtml).join('')}</div>`;
}

/** Simple prev/next + page-of-N pagination control. */
export function paginationHtml(page: number, limit: number, total: number, idPrefix: string): string {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  if (totalPages <= 1) return '';
  return `<nav class="store-pagination" aria-label="Pagination">
    <button type="button" id="${idPrefix}-prev" ${page <= 1 ? 'disabled' : ''}>&lsaquo; ${esc(t('store.common.back'))}</button>
    <span aria-live="polite">${page} / ${totalPages}</span>
    <button type="button" id="${idPrefix}-next" ${page >= totalPages ? 'disabled' : ''}>&rsaquo;</button>
  </nav>`;
}

const ORDER_STATUS_KEY: Record<StoreOrderStatus, string> = {
  pending: 'store.orderStatus.pending',
  paid: 'store.orderStatus.paid',
  fulfilled: 'store.orderStatus.fulfilled',
  cancelled: 'store.orderStatus.cancelled',
  refunded: 'store.orderStatus.refunded',
};

export function orderStatusLabel(status: StoreOrderStatus): string {
  return t(ORDER_STATUS_KEY[status] as Parameters<typeof t>[0]);
}

export function formatDate(iso: string): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return iso;
  return formatDateTime(time, { dateStyle: 'medium', timeStyle: 'short' });
}
