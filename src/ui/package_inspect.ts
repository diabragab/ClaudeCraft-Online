// Claudium Package inspect panel: a body-level overlay the Packages tab opens
// when a package card is clicked, reusing the Season 1 Armory inspect panel's
// visual language (src/ui/armory_inspect.ts) minus its 3D preview stage/scene
// toggles, which a currency bundle has no use for. Shows the package art, its
// merchandising badges (featured/discount/bonus), the total Claudium granted,
// and the existing Buy action (src/ui/daily_rewards_window.ts's
// openPackageCheckout, a real-money Stripe Checkout redirect on the web
// storefront).
import type { ClaudiumPackageDisplay } from './daily_rewards_window';
import { esc } from './esc';
import { formatNumber, t } from './i18n';
import { svgIcon } from './ui_icons';

export interface PackageInspectDeps {
  requestBuy(pkg: ClaudiumPackageDisplay): void;
}

export class PackageInspect {
  private overlay: HTMLElement | null = null;
  private openerFocus: HTMLElement | null = null;

  constructor(private readonly deps: PackageInspectDeps) {}

  get isOpen(): boolean {
    return this.overlay !== null;
  }

  open(pkg: ClaudiumPackageDisplay): void {
    this.close();
    this.openerFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overlay = document.createElement('div');
    overlay.className = 'armory-inspect-overlay open';
    overlay.addEventListener('keydown', (event) => {
      // A confirm prompt stacked above this overlay owns the keyboard, same
      // deference armory_inspect.ts uses: its own focus trap handles Tab, and
      // Escape must not close this panel out from under a live purchase prompt.
      if (document.getElementById('confirm-dialog')) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        this.close();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusables = overlay.querySelectorAll<HTMLElement>('button:not([disabled])');
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !overlay.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !overlay.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    });
    overlay.addEventListener('mousedown', (event) => {
      if (document.getElementById('confirm-dialog')) return;
      if (event.target === overlay) this.close();
    });
    const total = formatNumber(pkg.claudiumAmount + pkg.bonusAmount, { maximumFractionDigits: 0 });
    const price = formatNumber(pkg.price / 100, {
      maximumFractionDigits: 2,
      minimumFractionDigits: 2,
    });
    const art = pkg.imageUrl ?? '/claudium/icons/stack_04.webp';
    const badges =
      (pkg.featured
        ? `<span class="armory-badge armory-badge-featured">${esc(t('hudChrome.wocStore.packageFeatured'))}</span>`
        : '') +
      (pkg.discountPercent > 0
        ? `<span class="armory-badge armory-badge-discount">${esc(t('hudChrome.wocStore.packageDiscount', { percent: formatNumber(pkg.discountPercent, { maximumFractionDigits: 0 }) }))}</span>`
        : '') +
      (pkg.bonusAmount > 0
        ? `<span class="armory-badge">${esc(t('hudChrome.wocStore.packageBonus', { bonus: formatNumber(pkg.bonusAmount, { maximumFractionDigits: 0 }) }))}</span>`
        : '');
    overlay.innerHTML =
      `<div class="armory-inspect pack-inspect" role="dialog" aria-modal="true" aria-label="${esc(t('hudChrome.wocStore.inspectAria', { item: pkg.name }))}">` +
      `<button type="button" class="x-btn armory-inspect-close" data-package-close aria-label="${esc(t('hudChrome.wocStore.close'))}">${svgIcon('close')}</button>` +
      `<div class="armory-inspect-stage"><img src="${esc(art)}" alt=""></div>` +
      `<div class="armory-inspect-panel">` +
      `<div class="armory-inspect-details">` +
      `<div class="armory-inspect-head"><span class="armory-collection">${esc(t('hudChrome.wocStore.packagesTab'))}</span></div>` +
      `<h2>${esc(pkg.name)}</h2>` +
      (badges ? `<span class="armory-badges">${badges}</span>` : '') +
      `<span class="armory-price"><img src="/claudium/icons/claudium_coin_64.webp" alt=""><strong>${total}</strong></span>` +
      `</div>` +
      `<div class="armory-inspect-actions" data-package-actions>` +
      `<button type="button" class="armory-buy" data-package-buy>${esc(t('hudChrome.wocStore.packageBuy', { price, currency: pkg.currency }))}</button>` +
      `</div>` +
      `</div></div>`;
    document.body.appendChild(overlay);
    this.overlay = overlay;
    overlay.querySelector('[data-package-close]')?.addEventListener('click', () => this.close());
    overlay
      .querySelector<HTMLButtonElement>('[data-package-buy]')
      ?.addEventListener('click', () => {
        this.deps.requestBuy(pkg);
      });
    (overlay.querySelector('[data-package-close]') as HTMLElement | null)?.focus();
  }

  close(): void {
    const wasOpen = this.overlay !== null;
    this.overlay?.remove();
    this.overlay = null;
    if (wasOpen && this.openerFocus?.isConnected) this.openerFocus.focus();
    this.openerFocus = null;
  }
}
