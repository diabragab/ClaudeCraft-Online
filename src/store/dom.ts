// Shared render helpers for the storefront pages: loading/error/empty state
// snippets, the reusable product-card grid cell, and pagination controls.
// Kept as one small sibling module (module-first) rather than duplicated
// per-page markup, since every listing page (home's featured/new sections,
// categories, product search) renders the same card shape.

import { formatDateTime, t } from '../ui/i18n';
import { esc } from '../ui/esc';
import { shopRarityPresentation } from '../ui/shop_rarity_view';
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

/** The `amount * (100 - discountPercent) / 100` rounded discounted price, in the same raw unit. */
function discountedAmount(amount: number, discountPercent: number): number {
  return Math.round((amount * (100 - discountPercent)) / 100);
}

/** A single product grid cell: image-free card with name, price, availability. */
export function productCardHtml(product: StoreProduct): string {
  const rawAmount =
    product.priceGoldCopper ?? product.priceClaudium ?? product.priceUsdCents ?? null;
  const currency =
    product.priceGoldCopper !== null
      ? 'gold'
      : product.priceClaudium !== null
        ? 'claudium'
        : 'usd';
  const priceHtml =
    rawAmount === null
      ? ''
      : product.discountPercent !== null
        ? `<span class="store-price-original">${esc(formatPrice(rawAmount, currency))}</span> ` +
          `<span class="store-price-discounted">${esc(formatPrice(discountedAmount(rawAmount, product.discountPercent), currency))}</span>`
        : esc(formatPrice(rawAmount, currency));
  const purchasable = isPurchasable(product.availability);
  const presentation = shopRarityPresentation(product);
  const rarityClass = presentation.cardRarityClass ? ` ${presentation.cardRarityClass}` : '';
  const badgeChips = presentation.badges.length
    ? `<span class="shop-badge-row">${presentation.badges
        .map((badge) => `<span class="${badge.class}">${esc(t(badge.labelKey))}</span>`)
        .join('')}</span>`
    : '';
  return `<a class="store-card${rarityClass}" href="${esc(hrefFor(`products/${product.slug}`))}">
    ${badgeChips}
    <div class="store-card-body">
      <h3 class="store-card-title">${esc(product.name)}</h3>
      <div class="store-card-price">${priceHtml}</div>
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
