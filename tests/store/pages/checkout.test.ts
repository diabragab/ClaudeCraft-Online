// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const createOrder = vi.fn();
vi.mock('../../../src/store/shop_api', () => ({
  createOrder: (...args: unknown[]) => createOrder(...args),
}));

import { checkoutPage } from '../../../src/store/pages/checkout';
import { ApiError } from '../../../src/store/api';
import { CartController } from '../../../src/store/cart_controller';
import { t } from '../../../src/ui/i18n';

const SWORD = { productId: 1, slug: 'iron-sword', name: 'Iron Sword', unitPrice: 100 };
const SESSION_KEY = 'woc_session';

function signIn(): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify({ token: 'a'.repeat(64), username: 'playerOne' }));
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  localStorage.clear();
  createOrder.mockReset();
});

describe('checkoutPage', () => {
  it('shows a sign-in prompt when there is no session', () => {
    const cart = new CartController();
    cart.add(SWORD, 1, 'gold');
    const root = document.createElement('div');
    root.innerHTML = checkoutPage.render({ cart, navigate: vi.fn() });
    expect(root.textContent).toContain(t('store.checkout.signInRequiredTitle'));
  });

  it('shows an empty-cart message when signed in with nothing in the cart', () => {
    signIn();
    const cart = new CartController();
    const root = document.createElement('div');
    root.innerHTML = checkoutPage.render({ cart, navigate: vi.fn() });
    expect(root.textContent).toContain(t('store.checkout.emptyCart'));
  });

  it('reviews the cart contents and places an order, then navigates to confirmation', async () => {
    signIn();
    createOrder.mockResolvedValue({ id: 42 });
    const cart = new CartController();
    cart.add(SWORD, 2, 'gold');
    const navigate = vi.fn();
    const root = document.createElement('div');
    const ctx = { cart, navigate };
    root.innerHTML = checkoutPage.render(ctx);
    checkoutPage.mount?.(root, ctx);

    expect(root.textContent).toContain('Iron Sword');

    const form = root.querySelector('#store-checkout-form') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flush();

    expect(createOrder).toHaveBeenCalledWith({
      currency: 'gold',
      items: [{ productId: 1, quantity: 2 }],
      note: '',
    });
    expect(cart.getState().items).toHaveLength(0);
    expect(navigate).toHaveBeenCalledWith('/store/confirmation/42');
  });

  it('shows an out-of-stock error and keeps the cart intact on a rejected order', async () => {
    signIn();
    createOrder.mockRejectedValue(new ApiError(400, 'out of stock', 'shop.out_of_stock'));
    const cart = new CartController();
    cart.add(SWORD, 1, 'gold');
    const root = document.createElement('div');
    const ctx = { cart, navigate: vi.fn() };
    root.innerHTML = checkoutPage.render(ctx);
    checkoutPage.mount?.(root, ctx);

    const form = root.querySelector('#store-checkout-form') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flush();

    expect(root.querySelector('#store-checkout-status')?.textContent).toBe(
      t('store.checkout.outOfStockError'),
    );
    expect(cart.getState().items).toHaveLength(1);
  });
});
