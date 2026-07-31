// Premium Shop (Phase 2C): the purchase success/failure popup, a body-level
// overlay opened once per checkout attempt from daily_rewards_window.ts's
// purchaseProduct(). Self-contained like package_inspect.ts/armory_inspect.ts
// (its own overlay, its own Escape/backdrop-click dismissal) rather than a
// persistent `.window.panel` in index.html: it has no stable root to hand
// hud.ts's windowFocus()/closeManagedWindow() switch, so it drives the shared
// FocusManager directly, the same way Hud's own confirmDialog() does for its
// dynamically created #confirm-dialog.
import { markDialogRoot } from './dialog_root';
import { esc } from './esc';
import type { FocusManager, FocusTrapHandle } from './focus_manager';
import { t } from './i18n';
import {
  buildShopPurchaseResultView,
  type ShopPurchaseResultInput,
} from './shop_purchase_result_view';
import { svgIcon } from './ui_icons';

export interface ShopPurchaseResultWindowDeps {
  focusManager: FocusManager;
}

// Long enough to read the item name and rarity flourish; short enough that an
// unattended popup does not linger over the store grid indefinitely.
const AUTO_DISMISS_MS = 6000;

export class ShopPurchaseResultWindow {
  private overlay: HTMLElement | null = null;
  private trap: FocusTrapHandle | null = null;
  private dismissTimer: number | null = null;

  constructor(private readonly deps: ShopPurchaseResultWindowDeps) {}

  get isOpen(): boolean {
    return this.overlay !== null;
  }

  open(input: ShopPurchaseResultInput): void {
    this.close();
    const view = buildShopPurchaseResultView(input);
    const badgeChips = view.presentation.badges.length
      ? `<span class="shop-result-badges">${view.presentation.badges
          .map((badge) => `<span class="${badge.class}">${esc(t(badge.labelKey))}</span>`)
          .join('')}</span>`
      : '';
    const cardClass =
      `shop-result-card${view.presentation.cardRarityClass ? ` ${view.presentation.cardRarityClass}` : ''}` +
      `${view.celebratory ? ' shop-result-celebratory' : ''}${view.kind === 'failure' ? ' shop-result-failure' : ''}`;
    const dismissLabel = esc(t('hudChrome.wocStore.purchaseResult.dismiss'));
    const overlay = document.createElement('div');
    overlay.className = 'shop-result-overlay open';
    overlay.innerHTML =
      `<div class="${cardClass}">` +
      `<button type="button" class="x-btn shop-result-close" data-close aria-label="${dismissLabel}">${svgIcon('close')}</button>` +
      `<span class="shop-result-icon">${svgIcon(view.kind === 'success' ? 'check' : 'x')}</span>` +
      (view.art ? `<img class="shop-result-art" src="${esc(view.art)}" alt="">` : '') +
      badgeChips +
      `<h3 id="shop-result-title">${esc(t(view.titleKey))}</h3>` +
      `<p>${esc(t(view.bodyKey, { item: view.productName }))}</p>` +
      `<button type="button" class="btn shop-result-ok" data-close>${dismissLabel}</button>` +
      `</div>`;
    const card = overlay.querySelector<HTMLElement>('.shop-result-card');
    if (card) markDialogRoot(card, { labelledBy: 'shop-result-title', modal: true });
    overlay.addEventListener('mousedown', (event) => {
      if (event.target === overlay) this.close();
    });
    overlay.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      this.close();
    });
    overlay.querySelectorAll<HTMLElement>('[data-close]').forEach((button) => {
      button.addEventListener('click', () => this.close());
    });
    document.body.appendChild(overlay);
    this.overlay = overlay;
    this.trap = this.deps.focusManager.open({ root: () => card });
    this.trap.focusFirst();
    this.dismissTimer = window.setTimeout(() => this.close(), AUTO_DISMISS_MS);
  }

  close(): void {
    if (this.dismissTimer !== null) {
      window.clearTimeout(this.dismissTimer);
      this.dismissTimer = null;
    }
    this.trap?.release();
    this.trap = null;
    this.overlay?.remove();
    this.overlay = null;
  }
}
