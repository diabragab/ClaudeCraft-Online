// Cart page: line items with a quantity stepper + remove, subtotal, and a
// link to checkout. Reads live from the shared CartController (ctx.cart), so
// it always reflects whatever add-to-cart actions ran on other pages.

import { esc } from '../../ui/esc';
import { t } from '../../ui/i18n';
import type { CartItem, CartState } from '../cart';
import { cartSubtotal, isCartEmpty } from '../cart';
import { formatPrice } from '../format';
import type { StorePage, StorePageContext } from '../page';
import { hrefFor } from '../routes';

const CONTENT_ID = 'store-cart-content';

function lineHtml(item: CartItem, currency: NonNullable<CartState['currency']>): string {
  const lineTotal = item.unitPrice * item.quantity;
  return `<tr data-product-id="${item.productId}">
    <td><a href="${esc(hrefFor(`products/${item.slug}`))}">${esc(item.name)}</a></td>
    <td class="num">${esc(formatPrice(item.unitPrice, currency))}</td>
    <td class="num">
      <input type="number" min="1" max="9999" value="${item.quantity}" class="store-cart-qty" data-product-id="${item.productId}" aria-label="${esc(t('store.common.quantityLabel'))}" />
    </td>
    <td class="num">${esc(formatPrice(lineTotal, currency))}</td>
    <td><button type="button" class="store-cart-remove" data-product-id="${item.productId}">${esc(t('store.common.remove'))}</button></td>
  </tr>`;
}

function renderCart(state: CartState): string {
  if (isCartEmpty(state) || state.currency === null) {
    return `<div class="store-state store-empty">
      <p>${esc(t('store.cart.empty'))}</p>
      <a href="${esc(hrefFor('products'))}">${esc(t('store.common.continueShopping'))}</a>
    </div>`;
  }
  const currency = state.currency;
  const subtotal = cartSubtotal(state);
  return `
    <div class="store-table-scroll">
      <table>
        <thead>
          <tr>
            <th>${esc(t('store.cart.colProduct'))}</th>
            <th class="num">${esc(t('store.cart.colPrice'))}</th>
            <th class="num">${esc(t('store.cart.colQuantity'))}</th>
            <th class="num">${esc(t('store.cart.colSubtotal'))}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${state.items.map((i) => lineHtml(i, currency)).join('')}</tbody>
      </table>
    </div>
    <div class="store-cart-summary">
      <div class="store-cart-subtotal">${esc(t('store.cart.subtotalLabel'))}: <strong>${esc(formatPrice(subtotal, currency))}</strong></div>
      <a class="store-checkout-link" href="${esc(hrefFor('checkout'))}">${esc(t('store.cart.checkout'))}</a>
    </div>
  `;
}

function wireCart(root: HTMLElement, ctx: StorePageContext, rerender: () => void): void {
  const slot = root.querySelector(`#${CONTENT_ID}`);
  slot?.addEventListener('click', (e) => {
    const button = (e.target as HTMLElement).closest<HTMLButtonElement>('.store-cart-remove');
    if (!button) return;
    const productId = Number(button.dataset.productId);
    ctx.cart.remove(productId);
    rerender();
  });
  slot?.addEventListener('change', (e) => {
    const input = (e.target as HTMLElement).closest<HTMLInputElement>('.store-cart-qty');
    if (!input) return;
    const productId = Number(input.dataset.productId);
    const quantity = Number(input.value);
    ctx.cart.updateQuantity(productId, quantity);
    rerender();
  });
}

export const cartPage: StorePage = {
  render(ctx: StorePageContext) {
    return `<h1>${esc(t('store.cart.title'))}</h1><div id="${CONTENT_ID}">${renderCart(ctx.cart.getState())}</div>`;
  },
  mount(root: HTMLElement, ctx: StorePageContext) {
    const rerender = (): void => {
      const slot = root.querySelector(`#${CONTENT_ID}`);
      if (slot) slot.innerHTML = renderCart(ctx.cart.getState());
    };
    wireCart(root, ctx, rerender);
    const unsubscribe = ctx.cart.subscribe(rerender);
    return unsubscribe;
  },
};
