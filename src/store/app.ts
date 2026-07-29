// Storefront app orchestrator. Owns the chrome (header/nav/cart badge/session)
// and the router, renders the matched page into <main>, and runs the previous
// page's cleanup before every swap. Mirrors src/guide/app.ts's shape,
// simplified for this surface's flatter page set (no view-transitions,
// breadcrumbs, or per-route head metadata).

import { esc } from '../ui/esc';
import { t } from '../ui/i18n';
import { clearSession, getSession } from './api';
import { cartItemCount } from './cart';
import { CartController } from './cart_controller';
import { PAGES } from './pages/index';
import { StoreRouter } from './router';
import { hrefFor, matchRoute, STORE_BASE } from './routes';

export class StoreApp {
  private readonly mount: HTMLElement;
  private readonly router: StoreRouter;
  private readonly cart = new CartController();
  private mainEl!: HTMLElement;
  private cartBadgeEl!: HTMLElement;
  private pageCleanup: (() => void) | void = undefined;
  private firstNav = true;

  constructor(mount: HTMLElement) {
    this.mount = mount;
    this.router = new StoreRouter((pathname) => this.renderRoute(pathname));
  }

  start(): void {
    this.buildChrome();
    this.router.start();
  }

  private buildChrome(): void {
    const session = getSession();
    this.mount.innerHTML = `
      <a class="store-skip-link" href="#store-main">${esc(t('store.common.back'))}</a>
      <header class="store-header">
        <a class="store-brand" href="${esc(hrefFor(''))}">${esc(t('store.brand'))}</a>
        <nav class="store-nav" aria-label="${esc(t('store.brand'))}">
          <a href="${esc(hrefFor(''))}">${esc(t('store.nav.home'))}</a>
          <a href="${esc(hrefFor('categories'))}">${esc(t('store.nav.categories'))}</a>
          <a href="${esc(hrefFor('products'))}">${esc(t('store.nav.products'))}</a>
          <a href="${esc(hrefFor('cart'))}">${esc(t('store.nav.cart'))} <span id="store-cart-badge" class="store-cart-badge"></span></a>
          <a href="${esc(hrefFor('orders'))}">${esc(t('store.nav.orders'))}</a>
        </nav>
        <div class="store-session">
          ${
            session
              ? `<span>${esc(t('store.nav.signedInAs', { name: session.username }))}</span> <button type="button" id="store-sign-out">${esc(t('store.nav.signOut'))}</button>`
              : `<a href="/">${esc(t('store.nav.signIn'))}</a>`
          }
        </div>
      </header>
      <main id="store-main" tabindex="-1"></main>
    `;
    this.mainEl = this.mount.querySelector('#store-main') as HTMLElement;
    this.cartBadgeEl = this.mount.querySelector('#store-cart-badge') as HTMLElement;
    this.updateCartBadge();
    this.cart.subscribe(() => this.updateCartBadge());
    this.mount.querySelector('#store-sign-out')?.addEventListener('click', () => {
      clearSession();
      this.buildChrome();
      this.renderRoute(window.location.pathname);
    });
  }

  private updateCartBadge(): void {
    const count = cartItemCount(this.cart.getState());
    this.cartBadgeEl.textContent = count > 0 ? String(count) : '';
  }

  private renderRoute(pathname: string): void {
    if (this.pageCleanup) this.pageCleanup();
    const match = matchRoute(pathname);
    const page = PAGES[match.id];
    const ctx = {
      param: match.param,
      cart: this.cart,
      navigate: (path: string) => this.router.go(path),
    };
    this.mainEl.innerHTML = page.render(ctx);
    this.pageCleanup = page.mount?.(this.mainEl, ctx);
    document.title = t('store.brand');
    if (this.firstNav) {
      this.firstNav = false;
    } else {
      window.scrollTo({ top: 0, behavior: 'instant' });
      this.mainEl.focus({ preventScroll: true });
    }
  }
}

export { STORE_BASE };
