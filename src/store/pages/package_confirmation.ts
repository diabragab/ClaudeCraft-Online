// Claudium Package purchase confirmation page: where Stripe Checkout
// redirects back to (success_url is built server-side in
// server/claudium_purchases_routes.ts as
// /store/packages/confirmation?session_id={CHECKOUT_SESSION_ID}). The
// session id travels as a QUERY param, not a route :param (Stripe substitutes
// it into the URL verbatim), so this page reads window.location.search
// directly rather than ctx.param.
//
// The webhook (server/stripe_webhook_routes.ts) is what actually credits the
// ledger, and it can race this redirect, so a 'pending' status here polls a
// bounded number of times before giving up and telling the player their
// Claudium balance will update shortly.

import { esc } from '../../ui/esc';
import { t } from '../../ui/i18n';
import { errorHtml, loadingHtml } from '../dom';
import { formatPrice } from '../format';
import type { StorePage } from '../page';
import { hrefFor } from '../routes';
import { getPurchaseStatus } from '../shop_api';
import type { StoreClaudiumPurchase } from '../types';

const CONTENT_ID = 'store-package-confirmation-content';
const RETRY_ID = 'store-package-confirmation-retry';
const POLL_INTERVAL_MS = 2000;
const MAX_POLLS = 15;

function sessionIdFromLocation(): string | null {
  return new URL(window.location.href).searchParams.get('session_id');
}

function successHtml(purchase: StoreClaudiumPurchase): string {
  const total = purchase.claudiumAmount + purchase.bonusAmount;
  return `<div class="store-state store-confirmation">
    <h1>${esc(t('store.packageConfirmation.paidTitle'))}</h1>
    <p>${esc(t('store.packageConfirmation.paidBody', { amount: total, package: purchase.packageName }))}</p>
    <a href="${esc(hrefFor('packages'))}">${esc(t('store.common.continueShopping'))}</a>
  </div>`;
}

function pendingHtml(): string {
  return `<div class="store-state store-confirmation">
    <h1>${esc(t('store.packageConfirmation.pendingTitle'))}</h1>
    <p>${esc(t('store.packageConfirmation.pendingBody'))}</p>
  </div>`;
}

function pendingTimedOutHtml(): string {
  return `<div class="store-state store-confirmation">
    <h1>${esc(t('store.packageConfirmation.pendingTitle'))}</h1>
    <p>${esc(t('store.packageConfirmation.pendingTimeoutBody'))}</p>
    <a href="${esc(hrefFor('packages'))}">${esc(t('store.common.continueShopping'))}</a>
  </div>`;
}

function failedHtml(): string {
  return `<div class="store-state store-confirmation">
    <h1>${esc(t('store.packageConfirmation.failedTitle'))}</h1>
    <p>${esc(t('store.packageConfirmation.failedBody'))}</p>
    <a href="${esc(hrefFor('packages'))}">${esc(t('store.common.continueShopping'))}</a>
  </div>`;
}

function missingSessionHtml(): string {
  return `<div class="store-state">
    <p>${esc(t('store.packageConfirmation.missingSession'))}</p>
    <a href="${esc(hrefFor('packages'))}">${esc(t('store.common.continueShopping'))}</a>
  </div>`;
}

function renderForStatus(purchase: StoreClaudiumPurchase, pollsExhausted: boolean): string {
  if (purchase.status === 'paid') return successHtml(purchase);
  if (purchase.status === 'pending') return pollsExhausted ? pendingTimedOutHtml() : pendingHtml();
  return failedHtml();
}

async function pollStatus(root: HTMLElement, sessionId: string, attempt: number): Promise<void> {
  const slot = root.querySelector(`#${CONTENT_ID}`);
  if (!slot) return;
  try {
    const purchase = await getPurchaseStatus(sessionId);
    if (purchase.status === 'pending' && attempt < MAX_POLLS) {
      slot.innerHTML = pendingHtml();
      const timer = window.setTimeout(
        () => void pollStatus(root, sessionId, attempt + 1),
        POLL_INTERVAL_MS,
      );
      root.dataset.pollTimer = String(timer);
      return;
    }
    slot.innerHTML = renderForStatus(purchase, attempt >= MAX_POLLS);
  } catch {
    slot.innerHTML = errorHtml(RETRY_ID);
    slot
      .querySelector(`#${RETRY_ID}`)
      ?.addEventListener('click', () => void pollStatus(root, sessionId, 0));
  }
}

export const packageConfirmationPage: StorePage = {
  render() {
    if (!sessionIdFromLocation()) return missingSessionHtml();
    return `<div id="${CONTENT_ID}">${loadingHtml()}</div>`;
  },
  mount(root: HTMLElement) {
    const sessionId = sessionIdFromLocation();
    if (!sessionId) return;
    void pollStatus(root, sessionId, 0);
    return () => {
      const timer = Number(root.dataset.pollTimer);
      if (Number.isFinite(timer)) window.clearTimeout(timer);
    };
  },
};
