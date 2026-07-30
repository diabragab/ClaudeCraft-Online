// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cartPage } from '../../../src/store/pages/cart_page';
import { CartController } from '../../../src/store/cart_controller';
import { t } from '../../../src/ui/i18n';

const SWORD = { productId: 1, slug: 'iron-sword', name: 'Iron Sword', unitPrice: 100 };
const SHIELD = { productId: 2, slug: 'wooden-shield', name: 'Wooden Shield', unitPrice: 50 };

beforeEach(() => {
  localStorage.clear();
});

describe('cartPage', () => {
  it('shows the empty state when the cart has nothing in it', () => {
    const cart = new CartController();
    const root = document.createElement('div');
    root.innerHTML = cartPage.render({ cart, navigate: vi.fn() });
    expect(root.querySelector('.store-empty')?.textContent).toContain(t('store.cart.empty'));
  });

  it('lists every line item with its subtotal', () => {
    const cart = new CartController();
    cart.add(SWORD, 2, 'gold');
    cart.add(SHIELD, 1, 'gold');
    const root = document.createElement('div');
    const ctx = { cart, navigate: vi.fn() };
    root.innerHTML = cartPage.render(ctx);
    cartPage.mount?.(root, ctx);

    const rows = root.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(2);
  });

  it('removes a line item and re-renders live via the cart subscription', () => {
    const cart = new CartController();
    cart.add(SWORD, 1, 'gold');
    const root = document.createElement('div');
    const ctx = { cart, navigate: vi.fn() };
    root.innerHTML = cartPage.render(ctx);
    cartPage.mount?.(root, ctx);

    const removeButton = root.querySelector('.store-cart-remove') as HTMLButtonElement;
    removeButton.click();

    expect(cart.getState().items).toHaveLength(0);
    expect(root.querySelector('.store-empty')).not.toBeNull();
  });

  it('updates a line item quantity via the stepper input', () => {
    const cart = new CartController();
    cart.add(SWORD, 1, 'gold');
    const root = document.createElement('div');
    const ctx = { cart, navigate: vi.fn() };
    root.innerHTML = cartPage.render(ctx);
    cartPage.mount?.(root, ctx);

    const qtyInput = root.querySelector('.store-cart-qty') as HTMLInputElement;
    qtyInput.value = '4';
    qtyInput.dispatchEvent(new Event('change', { bubbles: true }));

    expect(cart.getState().items[0].quantity).toBe(4);
  });
});
