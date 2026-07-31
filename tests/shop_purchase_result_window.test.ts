// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FocusManager } from '../src/ui/focus_manager';
import { ShopPurchaseResultWindow } from '../src/ui/shop_purchase_result_window';

const SUCCESS_PRODUCT = { name: 'Iron Sword', rarity: 'common' as const, badges: [], art: null };

function overlay(): HTMLElement | null {
  return document.body.querySelector('.shop-result-overlay');
}

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ShopPurchaseResultWindow', () => {
  it('opens a success popup naming the product', () => {
    const win = new ShopPurchaseResultWindow({ focusManager: new FocusManager() });
    win.open({ kind: 'success', product: SUCCESS_PRODUCT });

    expect(win.isOpen).toBe(true);
    const card = overlay()?.querySelector('.shop-result-card');
    expect(card).not.toBeNull();
    expect(card?.classList.contains('shop-result-failure')).toBe(false);
    expect(card?.textContent).toContain('Iron Sword');
    win.close();
  });

  it('opens a failure popup with the failure card class', () => {
    const win = new ShopPurchaseResultWindow({ focusManager: new FocusManager() });
    win.open({ kind: 'failure', product: SUCCESS_PRODUCT });

    const card = overlay()?.querySelector('.shop-result-card');
    expect(card?.classList.contains('shop-result-failure')).toBe(true);
    expect(card?.classList.contains('shop-result-celebratory')).toBe(false);
    win.close();
  });

  it('adds the celebratory class only for an epic-or-above success', () => {
    const win = new ShopPurchaseResultWindow({ focusManager: new FocusManager() });
    win.open({ kind: 'success', product: { ...SUCCESS_PRODUCT, rarity: 'legendary' } });
    expect(
      overlay()?.querySelector('.shop-result-card')?.classList.contains('shop-result-celebratory'),
    ).toBe(true);
    win.close();

    win.open({ kind: 'success', product: { ...SUCCESS_PRODUCT, rarity: 'rare' } });
    expect(
      overlay()?.querySelector('.shop-result-card')?.classList.contains('shop-result-celebratory'),
    ).toBe(false);
    win.close();
  });

  it('renders the rarity class and badge chips on the card', () => {
    const win = new ShopPurchaseResultWindow({ focusManager: new FocusManager() });
    win.open({
      kind: 'success',
      product: { ...SUCCESS_PRODUCT, rarity: 'epic', badges: ['hot', 'limited'] },
    });
    const card = overlay()?.querySelector('.shop-result-card');
    expect(card?.classList.contains('rarity-epic')).toBe(true);
    const chips = [...(overlay()?.querySelectorAll('.shop-badge') ?? [])].map((el) => el.className);
    expect(chips).toEqual(['shop-badge shop-badge-hot', 'shop-badge shop-badge-limited']);
    win.close();
  });

  it('marks the card as an accessible, labelled modal dialog', () => {
    const win = new ShopPurchaseResultWindow({ focusManager: new FocusManager() });
    win.open({ kind: 'success', product: SUCCESS_PRODUCT });
    const card = overlay()?.querySelector('.shop-result-card');
    expect(card?.getAttribute('role')).toBe('dialog');
    expect(card?.getAttribute('aria-modal')).toBe('true');
    expect(card?.getAttribute('aria-labelledby')).toBe('shop-result-title');
    win.close();
  });

  it('closes and removes itself from the DOM on close()', () => {
    const win = new ShopPurchaseResultWindow({ focusManager: new FocusManager() });
    win.open({ kind: 'success', product: SUCCESS_PRODUCT });
    expect(overlay()).not.toBeNull();
    win.close();
    expect(overlay()).toBeNull();
    expect(win.isOpen).toBe(false);
  });

  it('closes on a click/data-close button', () => {
    const win = new ShopPurchaseResultWindow({ focusManager: new FocusManager() });
    win.open({ kind: 'success', product: SUCCESS_PRODUCT });
    overlay()
      ?.querySelector<HTMLButtonElement>('.shop-result-ok')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(overlay()).toBeNull();
  });

  it('closes on a backdrop click but not a click inside the card', () => {
    const win = new ShopPurchaseResultWindow({ focusManager: new FocusManager() });
    win.open({ kind: 'success', product: SUCCESS_PRODUCT });
    const card = overlay()?.querySelector('.shop-result-card') as HTMLElement;
    card.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(overlay()).not.toBeNull();

    overlay()?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(overlay()).toBeNull();
  });

  it('closes on Escape', () => {
    const win = new ShopPurchaseResultWindow({ focusManager: new FocusManager() });
    win.open({ kind: 'success', product: SUCCESS_PRODUCT });
    overlay()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(overlay()).toBeNull();
  });

  it('auto-dismisses after the timeout', () => {
    vi.useFakeTimers();
    const win = new ShopPurchaseResultWindow({ focusManager: new FocusManager() });
    win.open({ kind: 'success', product: SUCCESS_PRODUCT });
    expect(overlay()).not.toBeNull();
    vi.advanceTimersByTime(6000);
    expect(overlay()).toBeNull();
  });

  it('replaces a still-open popup rather than stacking a second one', () => {
    const win = new ShopPurchaseResultWindow({ focusManager: new FocusManager() });
    win.open({ kind: 'success', product: SUCCESS_PRODUCT });
    win.open({ kind: 'failure', product: { ...SUCCESS_PRODUCT, name: 'Steel Axe' } });
    expect(document.body.querySelectorAll('.shop-result-overlay').length).toBe(1);
    expect(overlay()?.textContent).toContain('Steel Axe');
    win.close();
  });
});
