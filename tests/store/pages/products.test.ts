// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const listProducts = vi.fn();
const getCategory = vi.fn();
vi.mock('../../../src/store/shop_api', () => ({
  listProducts: (...args: unknown[]) => listProducts(...args),
  getCategory: (...args: unknown[]) => getCategory(...args),
}));

import { productsPage } from '../../../src/store/pages/products';
import { CartController } from '../../../src/store/cart_controller';
import { t } from '../../../src/ui/i18n';

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function product(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    sku: 'sword-01',
    name: 'Iron Sword',
    slug: 'iron-sword',
    description: '',
    categoryId: 1,
    priceGoldCopper: 1000,
    priceClaudium: null,
    priceUsdCents: null,
    railSol: false,
    railUsdc: false,
    railWoc: false,
    status: 'active',
    featured: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    availability: 'in_stock',
    rarity: 'common',
    badges: [],
    isEvent: false,
    isLimited: false,
    discountPercent: null,
    bannerImage: null,
    previewImage: null,
    ...overrides,
  };
}

beforeEach(() => {
  listProducts.mockReset();
  getCategory.mockReset();
});

describe('productsPage', () => {
  it('lists products on the unscoped /products route', async () => {
    listProducts.mockResolvedValue({ rows: [product()], total: 1, page: 1, limit: 20 });
    const root = document.createElement('div');
    const ctx = { cart: new CartController(), navigate: vi.fn() };
    root.innerHTML = productsPage.render();
    productsPage.mount?.(root, ctx);
    await flush();

    expect(listProducts).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, limit: 20, categoryId: undefined }),
    );
    expect(root.textContent).toContain('Iron Sword');
  });

  it('resolves the category slug to an id and scopes the listing', async () => {
    getCategory.mockResolvedValue({ id: 7, name: 'Weapons', slug: 'weapons' });
    listProducts.mockResolvedValue({ rows: [], total: 0, page: 1, limit: 20 });
    const root = document.createElement('div');
    const ctx = { param: 'weapons', cart: new CartController(), navigate: vi.fn() };
    root.innerHTML = productsPage.render();
    productsPage.mount?.(root, ctx);
    await flush();

    expect(getCategory).toHaveBeenCalledWith('weapons');
    expect(listProducts).toHaveBeenCalledWith(expect.objectContaining({ categoryId: 7 }));
  });

  it('shows a category-not-found message when the category slug does not resolve', async () => {
    getCategory.mockRejectedValue(new Error('not found'));
    const root = document.createElement('div');
    const ctx = { param: 'ghost', cart: new CartController(), navigate: vi.fn() };
    root.innerHTML = productsPage.render();
    productsPage.mount?.(root, ctx);
    await flush();

    expect(root.textContent).toContain(t('store.products.categoryNotFound'));
  });

  it('shows the empty state when nothing matches', async () => {
    listProducts.mockResolvedValue({ rows: [], total: 0, page: 1, limit: 20 });
    const root = document.createElement('div');
    const ctx = { cart: new CartController(), navigate: vi.fn() };
    root.innerHTML = productsPage.render();
    productsPage.mount?.(root, ctx);
    await flush();

    expect(root.textContent).toContain(t('store.products.empty'));
  });

  it('re-queries with the search term after the debounce', async () => {
    vi.useFakeTimers();
    listProducts.mockResolvedValue({ rows: [], total: 0, page: 1, limit: 20 });
    const root = document.createElement('div');
    const ctx = { cart: new CartController(), navigate: vi.fn() };
    root.innerHTML = productsPage.render();
    productsPage.mount?.(root, ctx);
    await vi.runAllTimersAsync();
    listProducts.mockClear();

    const input = root.querySelector('#store-products-search') as HTMLInputElement;
    input.value = 'sword';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(350);

    expect(listProducts).toHaveBeenCalledWith(expect.objectContaining({ q: 'sword', page: 1 }));
    vi.useRealTimers();
  });
});
