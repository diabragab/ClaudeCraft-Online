// Claudium Packages page: the real-money purchase tiers, each starting a
// Stripe Checkout Session (server/claudium_purchases_routes.ts) that
// redirects the browser to Stripe's hosted checkout page. The in-game HUD's
// Packages tab (src/ui/daily_rewards_window.ts) opens this page in a new
// browser tab rather than embedding Stripe.js in the 3D client, since a full
// checkout redirect would otherwise drop the live game WebSocket session.

import { esc } from '../../ui/esc';
import { t } from '../../ui/i18n';
import { getSession, isAuthError } from '../api';
import { emptyHtml, errorHtml, loadingHtml } from '../dom';
import { formatPrice } from '../format';
import type { StorePage } from '../page';
import { listPackages, startPackageCheckout } from '../shop_api';
import type { StoreClaudiumPackage } from '../types';

const CONTENT_ID = 'store-packages-content';
const RETRY_ID = 'store-packages-retry';

function priceLine(pkg: StoreClaudiumPackage): string {
  const full = formatPrice(pkg.price, 'usd');
  if (pkg.discountPercent <= 0) return `<div class="store-package-price">${esc(full)}</div>`;
  const discounted = Math.round((pkg.price * (100 - pkg.discountPercent)) / 100);
  return `<div class="store-package-price">
    <span class="store-package-price-original">${esc(full)}</span>
    <span class="store-package-price-discounted">${esc(formatPrice(discounted, 'usd'))}</span>
  </div>`;
}

function badgesHtml(pkg: StoreClaudiumPackage): string {
  const badges: string[] = [];
  if (pkg.featured) {
    badges.push(
      `<span class="store-package-badge store-package-badge-featured">${esc(t('store.packages.featuredBadge'))}</span>`,
    );
  }
  if (pkg.discountPercent > 0) {
    badges.push(
      `<span class="store-package-badge store-package-badge-discount">${esc(t('store.packages.discountBadge', { percent: pkg.discountPercent }))}</span>`,
    );
  }
  return badges.length > 0 ? `<div class="store-package-badges">${badges.join('')}</div>` : '';
}

function cardHtml(pkg: StoreClaudiumPackage): string {
  const image = pkg.imageUrl
    ? `<img class="store-package-image" src="${esc(pkg.imageUrl)}" alt="" loading="lazy" />`
    : '';
  const bonus =
    pkg.bonusAmount > 0
      ? `<div class="store-package-bonus">${esc(t('store.packages.bonusLabel', { amount: pkg.bonusAmount }))}</div>`
      : '';
  return `<div class="store-card store-package-card${pkg.featured ? ' store-package-featured' : ''}" data-package-id="${pkg.id}">
    ${badgesHtml(pkg)}
    ${image}
    <h3 class="store-card-title">${esc(pkg.name)}</h3>
    <div class="store-package-amount">${esc(t('store.packages.claudiumAmount', { amount: pkg.claudiumAmount }))}</div>
    ${bonus}
    ${priceLine(pkg)}
    <button type="button" class="store-package-buy" data-buy-package="${pkg.id}">${esc(t('store.packages.buy'))}</button>
    <div class="store-package-status" role="alert"></div>
  </div>`;
}

function renderSignInRequired(): string {
  return `<div class="store-state">
    <h1>${esc(t('store.packages.title'))}</h1>
    <p>${esc(t('store.packages.signInRequiredBody'))}</p>
    <a href="/">${esc(t('store.checkout.signInLink'))}</a>
  </div>`;
}

async function buyPackage(card: HTMLElement, packageId: number): Promise<void> {
  const button = card.querySelector<HTMLButtonElement>('.store-package-buy');
  const status = card.querySelector('.store-package-status');
  if (button) {
    button.disabled = true;
    button.textContent = t('store.packages.starting');
  }
  if (status) status.textContent = '';
  try {
    const result = await startPackageCheckout(packageId);
    window.location.href = result.url;
  } catch (err) {
    if (status) {
      status.textContent = isAuthError(err)
        ? t('store.packages.signInRequiredBody')
        : t('store.packages.checkoutFailed');
    }
    if (button) {
      button.disabled = false;
      button.textContent = t('store.packages.buy');
    }
  }
}

function wireBuyButtons(root: HTMLElement): void {
  root.querySelectorAll<HTMLButtonElement>('[data-buy-package]').forEach((button) => {
    button.addEventListener('click', () => {
      const card = button.closest<HTMLElement>('.store-package-card');
      const packageId = Number(button.dataset.buyPackage);
      if (card && Number.isFinite(packageId)) void buyPackage(card, packageId);
    });
  });
}

async function loadContent(root: HTMLElement): Promise<void> {
  const slot = root.querySelector(`#${CONTENT_ID}`);
  if (!slot) return;
  try {
    const result = await listPackages();
    if (result.rows.length === 0) {
      slot.innerHTML = emptyHtml(t('store.packages.empty'));
      return;
    }
    slot.innerHTML = `<div class="store-grid store-package-grid">${result.rows.map(cardHtml).join('')}</div>`;
    wireBuyButtons(slot as HTMLElement);
  } catch {
    slot.innerHTML = errorHtml(RETRY_ID);
    slot.querySelector(`#${RETRY_ID}`)?.addEventListener('click', () => void loadContent(root));
  }
}

export const packagesPage: StorePage = {
  render() {
    if (!getSession()) return renderSignInRequired();
    return `<h1>${esc(t('store.packages.title'))}</h1><p class="store-hint">${esc(t('store.packages.subtitle'))}</p><div id="${CONTENT_ID}">${loadingHtml()}</div>`;
  },
  mount(root: HTMLElement) {
    if (!getSession()) return;
    void loadContent(root);
  },
};
