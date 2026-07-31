// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getProduct = vi.fn();
vi.mock('../../../src/store/shop_api', () => ({
  getProduct: (...args: unknown[]) => getProduct(...args),
}));

import { productDetailPage } from '../../../src/store/pages/product_detail';
import { CartController } from '../../../src/store/cart_controller';
import { t } from '../../../src/ui/i18n';

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

const PRODUCT = {
  id: 9,
  sku: 'sword-01',
  name: 'Iron Sword',
  slug: 'iron-sword',
  description: 'A sturdy blade.',
  categoryId: 1,
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
  category: { id: 1, name: 'Weapons', slug: 'weapons', description: '', parentId: null, sortOrder: 0, status: 'active' as const, createdAt: '', updatedAt: '' },
};

beforeEach(() => {
  localStorage.clear();
  getProduct.mockReset();
});

describe('productDetailPage', () => {
  it('loads the product and adds it to the cart on submit', async () => {
    getProduct.mockResolvedValue(PRODUCT);
    const root = document.createElement('div');
    root.innerHTML = productDetailPage.render();
    const cart = new CartController();
    const ctx = { param: 'iron-sword', cart, navigate: vi.fn() };
    productDetailPage.mount?.(root, ctx);
    await flush();

    expect(root.querySelector('h1')?.textContent).toBe('Iron Sword');

    const form = root.querySelector('#store-product-form') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    expect(cart.getState().items).toEqual([
      { productId: 9, slug: 'iron-sword', name: 'Iron Sword', unitPrice: 1000, quantity: 1 },
    ]);
    expect(root.querySelector('#store-product-status')?.textContent).toBe(t('store.product.addedToCart'));
  });

  it('shows an error state when the product fails to load', async () => {
    getProduct.mockRejectedValue(new Error('not found'));
    const root = document.createElement('div');
    root.innerHTML = productDetailPage.render();
    const cart = new CartController();
    productDetailPage.mount?.(root, { param: 'ghost', cart, navigate: vi.fn() });
    await flush();

    expect(root.querySelector('.store-error')).not.toBeNull();
  });

  it('disables add-to-cart for an out-of-stock product', async () => {
    getProduct.mockResolvedValue({ ...PRODUCT, availability: 'out_of_stock' as const });
    const root = document.createElement('div');
    root.innerHTML = productDetailPage.render();
    const cart = new CartController();
    productDetailPage.mount?.(root, { param: 'iron-sword', cart, navigate: vi.fn() });
    await flush();

    const addButton = root.querySelector('#store-product-add') as HTMLButtonElement;
    expect(addButton.disabled).toBe(true);
  });
});
