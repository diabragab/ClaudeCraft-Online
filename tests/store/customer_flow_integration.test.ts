// @vitest-environment jsdom
//
// Integration test: chains the REAL page modules (not the router/app shell)
// through the full customer journey - browse a product, add it to the cart,
// review the cart, check out, and land on the confirmation page - sharing
// ONE CartController instance across the pages exactly as the live app does.
// Only the network boundary (shop_api.ts) is mocked; every page module,
// the pure cart core, and its localStorage persistence are all real.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const getProduct = vi.fn();
const createOrder = vi.fn();
vi.mock('../../src/store/shop_api', () => ({
  getProduct: (...args: unknown[]) => getProduct(...args),
  createOrder: (...args: unknown[]) => createOrder(...args),
}));

import { cartPage } from '../../src/store/pages/cart_page';
import { checkoutPage } from '../../src/store/pages/checkout';
import { confirmationPage } from '../../src/store/pages/confirmation';
import { productDetailPage } from '../../src/store/pages/product_detail';
import { CartController } from '../../src/store/cart_controller';
import { loadCart } from '../../src/store/cart_storage';

const SESSION_KEY = 'woc_session';
function signIn(): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify({ token: 'a'.repeat(64), username: 'playerOne' }));
}
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

const PRODUCT = {
  id: 1,
  sku: 'sword-01',
  name: 'Iron Sword',
  slug: 'iron-sword',
  description: 'A sturdy blade.',
  categoryId: null,
  priceGoldCopper: 1000,
  priceClaudium: null,
  priceUsdCents: null,
  railSol: false,
  railUsdc: false,
  railWoc: false,
  status: 'active' as const,
  featured: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  availability: 'in_stock' as const,
  rarity: 'common' as const,
  badges: [] as const,
  isEvent: false,
  isLimited: false,
  discountPercent: null,
  bannerImage: null,
  previewImage: null,
  category: null,
};

beforeEach(() => {
  localStorage.clear();
  getProduct.mockReset();
  createOrder.mockReset();
});

describe('customer flow: browse -> cart -> checkout -> confirmation', () => {
  it('carries the cart across pages and completes an order', async () => {
    signIn();
    getProduct.mockResolvedValue(PRODUCT);
    createOrder.mockResolvedValue({ id: 77 });
    const cart = new CartController();
    const navigate = vi.fn();

    // 1. Product detail: browse and add to cart.
    const productRoot = document.createElement('div');
    const productCtx = { param: 'iron-sword', cart, navigate };
    productRoot.innerHTML = productDetailPage.render();
    productDetailPage.mount?.(productRoot, productCtx);
    await flush();
    (productRoot.querySelector('#store-product-form') as HTMLFormElement).dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );

    expect(cart.getState().items).toHaveLength(1);
    // The add persisted to storage, so a fresh controller (a page reload) still sees it.
    expect(loadCart().items).toHaveLength(1);

    // 2. Cart page: review the line item added above.
    const cartRoot = document.createElement('div');
    const cartCtx = { cart, navigate };
    cartRoot.innerHTML = cartPage.render(cartCtx);
    cartPage.mount?.(cartRoot, cartCtx);
    expect(cartRoot.textContent).toContain('Iron Sword');

    // 3. Checkout: place the order.
    const checkoutRoot = document.createElement('div');
    const checkoutCtx = { cart, navigate };
    checkoutRoot.innerHTML = checkoutPage.render(checkoutCtx);
    checkoutPage.mount?.(checkoutRoot, checkoutCtx);
    (checkoutRoot.querySelector('#store-checkout-form') as HTMLFormElement).dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
    await flush();

    expect(createOrder).toHaveBeenCalledWith({
      currency: 'gold',
      items: [{ productId: 1, quantity: 1 }],
      note: '',
    });
    expect(cart.getState().items).toHaveLength(0); // cleared after a successful order
    expect(navigate).toHaveBeenCalledWith('/store/confirmation/77');

    // 4. Confirmation page.
    const confirmRoot = document.createElement('div');
    confirmRoot.innerHTML = confirmationPage.render({ param: '77', cart, navigate });
    expect(confirmRoot.textContent).toContain('77');
    expect(confirmRoot.querySelector('a')?.getAttribute('href')).toBe('/store/orders/77');
  });

  it('rejects adding a second product priced in a different currency', async () => {
    signIn();
    getProduct.mockResolvedValueOnce(PRODUCT).mockResolvedValueOnce({
      ...PRODUCT,
      id: 2,
      slug: 'usd-item',
      name: 'USD Item',
      priceGoldCopper: null,
      priceUsdCents: 500,
    });
    const cart = new CartController();

    const firstRoot = document.createElement('div');
    firstRoot.innerHTML = productDetailPage.render();
    productDetailPage.mount?.(firstRoot, { param: 'iron-sword', cart, navigate: vi.fn() });
    await flush();
    (firstRoot.querySelector('#store-product-form') as HTMLFormElement).dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
    expect(cart.getState().currency).toBe('gold');

    const secondRoot = document.createElement('div');
    secondRoot.innerHTML = productDetailPage.render();
    productDetailPage.mount?.(secondRoot, { param: 'usd-item', cart, navigate: vi.fn() });
    await flush();
    (secondRoot.querySelector('#store-product-form') as HTMLFormElement).dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );

    // The mismatched add is rejected; the cart still holds only the first item.
    expect(cart.getState().items).toHaveLength(1);
    expect(secondRoot.querySelector('#store-product-status')?.textContent).toBeTruthy();
  });
});
