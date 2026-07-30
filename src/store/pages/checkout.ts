// Checkout page: order review (line items + total from the live cart),
// a note field, and "Place order" which calls the EXISTING Phase 3 order
// creation transaction (POST /api/shop/orders, server/shop_orders.ts's
// ShopOrdersService.createOrder via the player-scoped wrapper) - the
// authoritative price/stock check, never re-implemented here. There is no
// payment gateway yet: the order is created 'pending' and a note makes that
// explicit (see store.checkout.paymentNote).

import { esc } from '../../ui/esc';
import { t } from '../../ui/i18n';
import { cartSubtotal, isCartEmpty } from '../cart';
import { getSession } from '../api';
import { formatPrice } from '../format';
import type { StorePage, StorePageContext } from '../page';
import { hrefFor } from '../routes';
import { createOrder } from '../shop_api';
import type { ShopOrderErrorLike } from './checkout_errors';
import { checkoutErrorMessage } from './checkout_errors';

const CONTENT_ID = 'store-checkout-content';

function renderSignInRequired(): string {
  return `<div class="store-state">
    <h1>${esc(t('store.checkout.signInRequiredTitle'))}</h1>
    <p>${esc(t('store.checkout.signInRequiredBody'))}</p>
    <a href="/">${esc(t('store.checkout.signInLink'))}</a>
  </div>`;
}

function renderEmptyCart(): string {
  return `<div class="store-state">
    <h1>${esc(t('store.checkout.title'))}</h1>
    <p>${esc(t('store.checkout.emptyCart'))}</p>
    <a href="${esc(hrefFor('products'))}">${esc(t('store.common.continueShopping'))}</a>
  </div>`;
}

function renderReview(ctx: StorePageContext): string {
  const state = ctx.cart.getState();
  if (state.currency === null) return renderEmptyCart();
  const currency = state.currency;
  const total = cartSubtotal(state);
  return `
    <h1>${esc(t('store.checkout.title'))}</h1>
    <section class="store-checkout-review">
      <h2>${esc(t('store.checkout.reviewTitle'))}</h2>
      <ul class="store-checkout-lines">
        ${state.items
          .map(
            (i) =>
              `<li>${esc(i.name)} &times; ${i.quantity} — ${esc(formatPrice(i.unitPrice * i.quantity, currency))}</li>`,
          )
          .join('')}
      </ul>
      <div class="store-checkout-total">${esc(t('store.checkout.totalLabel'))}: <strong>${esc(formatPrice(total, currency))}</strong></div>
    </section>
    <p class="store-checkout-payment-note">${esc(t('store.checkout.paymentNote'))}</p>
    <form id="store-checkout-form">
      <label>${esc(t('store.checkout.noteLabel'))}
        <textarea id="store-checkout-note" maxlength="500" placeholder="${esc(t('store.checkout.notePlaceholder'))}"></textarea>
      </label>
      <button type="submit" id="store-checkout-submit">${esc(t('store.checkout.placeOrder'))}</button>
      <div id="store-checkout-status" role="alert"></div>
    </form>
  `;
}

function wireForm(root: HTMLElement, ctx: StorePageContext): void {
  const form = root.querySelector<HTMLFormElement>('#store-checkout-form');
  const submitButton = root.querySelector<HTMLButtonElement>('#store-checkout-submit');
  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    void placeOrder(root, ctx, submitButton);
  });
}

async function placeOrder(
  root: HTMLElement,
  ctx: StorePageContext,
  submitButton: HTMLButtonElement | null,
): Promise<void> {
  const state = ctx.cart.getState();
  if (state.currency === null) return;
  const status = root.querySelector('#store-checkout-status');
  const noteInput = root.querySelector<HTMLTextAreaElement>('#store-checkout-note');
  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = t('store.checkout.placingOrder');
  }
  try {
    const order = await createOrder({
      currency: state.currency,
      items: state.items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
      note: noteInput?.value.trim() ?? '',
    });
    ctx.cart.clear();
    ctx.navigate(hrefFor(`confirmation/${order.id}`));
  } catch (err) {
    if (status) status.textContent = checkoutErrorMessage(err as ShopOrderErrorLike);
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = t('store.checkout.placeOrder');
    }
  }
}

export const checkoutPage: StorePage = {
  render(ctx: StorePageContext) {
    if (!getSession()) return `<div id="${CONTENT_ID}">${renderSignInRequired()}</div>`;
    if (isCartEmpty(ctx.cart.getState())) return `<div id="${CONTENT_ID}">${renderEmptyCart()}</div>`;
    return `<div id="${CONTENT_ID}">${renderReview(ctx)}</div>`;
  },
  mount(root: HTMLElement, ctx: StorePageContext) {
    if (!getSession() || isCartEmpty(ctx.cart.getState())) return;
    wireForm(root, ctx);
  },
};
