// Product detail page: full info, a currency picker (when a product carries
// more than one price), a quantity stepper, and add-to-cart.

import { esc } from '../../ui/esc';
import { t } from '../../ui/i18n';
import type { CartCurrency } from '../cart';
import { availabilityLabel, formatPrice, isPurchasable } from '../format';
import { errorHtml, loadingHtml } from '../dom';
import type { StorePage, StorePageContext } from '../page';
import { hrefFor } from '../routes';
import { getProduct } from '../shop_api';
import type { StoreProductDetail } from '../types';

const CONTENT_ID = 'store-product-content';
const RETRY_ID = 'store-product-retry';
const QTY_ID = 'store-product-qty';
const CURRENCY_ID = 'store-product-currency';
const ADD_ID = 'store-product-add';
const STATUS_ID = 'store-product-status';

function currenciesFor(product: StoreProductDetail): CartCurrency[] {
  const list: CartCurrency[] = [];
  if (product.priceGoldCopper !== null) list.push('gold');
  if (product.priceClaudium !== null) list.push('claudium');
  if (product.priceUsdCents !== null) list.push('usd');
  return list;
}

function priceFor(product: StoreProductDetail, currency: CartCurrency): number {
  if (currency === 'gold') return product.priceGoldCopper as number;
  if (currency === 'claudium') return product.priceClaudium as number;
  return product.priceUsdCents as number;
}

function renderProduct(product: StoreProductDetail): string {
  const currencies = currenciesFor(product);
  const purchasable = isPurchasable(product.availability);
  return `
    <nav class="store-breadcrumb">
      <a href="${esc(hrefFor('products'))}">${esc(t('store.nav.products'))}</a>
      ${product.category ? ` &raquo; <a href="${esc(hrefFor(`categories/${product.category.slug}`))}">${esc(product.category.name)}</a>` : ''}
    </nav>
    <h1>${esc(product.name)}</h1>
    <p class="store-product-sku">${esc(t('store.product.skuLabel'))}: ${esc(product.sku)}</p>
    ${product.description ? `<p class="store-product-desc">${esc(product.description)}</p>` : ''}
    <p class="store-product-availability${purchasable ? '' : ' store-unavailable'}">${esc(availabilityLabel(product.availability))}</p>
    <form class="store-product-form" id="store-product-form">
      ${
        currencies.length > 1
          ? `<label>${esc(t('store.product.currencyLabel'))}
              <select id="${CURRENCY_ID}">
                ${currencies.map((c) => `<option value="${c}">${esc(formatPrice(priceFor(product, c), c))}</option>`).join('')}
              </select>
            </label>`
          : `<input type="hidden" id="${CURRENCY_ID}" value="${currencies[0] ?? ''}" />
             <div class="store-product-price">${currencies.length === 1 ? esc(formatPrice(priceFor(product, currencies[0]), currencies[0])) : ''}</div>`
      }
      <label>${esc(t('store.common.quantityLabel'))}
        <input type="number" id="${QTY_ID}" min="1" max="9999" value="1" inputmode="numeric" />
      </label>
      <button type="submit" id="${ADD_ID}" ${purchasable ? '' : 'disabled'}>${esc(t('store.common.addToCart'))}</button>
    </form>
    <div id="${STATUS_ID}" role="status" aria-live="polite"></div>
  `;
}

async function loadContent(root: HTMLElement, slug: string, ctx: StorePageContext): Promise<void> {
  const slot = root.querySelector(`#${CONTENT_ID}`);
  if (!slot) return;
  try {
    const product = await getProduct(slug);
    slot.innerHTML = renderProduct(product);
    wireForm(root, product, ctx);
  } catch {
    slot.innerHTML = errorHtml(RETRY_ID);
    slot.querySelector(`#${RETRY_ID}`)?.addEventListener('click', () => void loadContent(root, slug, ctx));
  }
}

function wireForm(root: HTMLElement, product: StoreProductDetail, ctx: StorePageContext): void {
  const form = root.querySelector<HTMLFormElement>('#store-product-form');
  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    const currency = (root.querySelector<HTMLInputElement | HTMLSelectElement>(`#${CURRENCY_ID}`)
      ?.value ?? '') as CartCurrency;
    const qtyInput = root.querySelector<HTMLInputElement>(`#${QTY_ID}`);
    const quantity = Number(qtyInput?.value ?? '1');
    const status = root.querySelector(`#${STATUS_ID}`);
    if (!currency) return;
    const result = ctx.cart.add(
      { productId: product.id, slug: product.slug, name: product.name, unitPrice: priceFor(product, currency) },
      quantity,
      currency,
    );
    if (!status) return;
    if (result.ok) {
      status.textContent = t('store.product.addedToCart');
    } else if (result.error === 'currency_mismatch') {
      status.textContent = t('store.cart.currencyMismatchError');
    } else {
      status.textContent = t('store.product.addFailed');
    }
  });
}

export const productDetailPage: StorePage = {
  render() {
    return `<div id="${CONTENT_ID}">${loadingHtml()}</div>`;
  },
  mount(root: HTMLElement, ctx: StorePageContext) {
    if (!ctx.param) return;
    void loadContent(root, ctx.param, ctx);
  },
};
