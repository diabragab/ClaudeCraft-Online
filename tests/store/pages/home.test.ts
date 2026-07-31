// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const listProducts = vi.fn();
const listCategories = vi.fn();
vi.mock('../../../src/store/shop_api', () => ({
  listProducts: (...args: unknown[]) => listProducts(...args),
  listCategories: (...args: unknown[]) => listCategories(...args),
}));

import { homePage } from '../../../src/store/pages/home';
import { CartController } from '../../../src/store/cart_controller';
import { t } from '../../../src/ui/i18n';

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

const FEATURED = {
  id: 1,
  sku: 'sword-01',
  name: 'Featured Sword',
  slug: 'featured-sword',
  description: '',
  categoryId: null,
  priceGoldCopper: 500,
  priceClaudium: null,
  priceUsdCents: null,
  railSol: false,
  railUsdc: false,
  railWoc: false,
  status: 'active',
  featured: true,
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
};

beforeEach(() => {
  listProducts.mockReset();
  listCategories.mockReset();
});

describe('homePage', () => {
  it('renders featured products, new products, and categories', async () => {
    listProducts.mockImplementation(async (params: { featured?: boolean }) => ({
      rows: params.featured ? [FEATURED] : [],
      total: params.featured ? 1 : 0,
      page: 1,
      limit: 8,
    }));
    listCategories.mockResolvedValue({
      rows: [{ id: 1, name: 'Weapons', slug: 'weapons', description: '', parentId: null, sortOrder: 0, status: 'active', createdAt: '', updatedAt: '' }],
      total: 1,
      page: 1,
      limit: 8,
    });
    const root = document.createElement('div');
    const ctx = { cart: new CartController(), navigate: vi.fn() };
    root.innerHTML = homePage.render();
    homePage.mount?.(root, ctx);
    await flush();

    expect(root.textContent).toContain('Featured Sword');
    expect(root.textContent).toContain(t('store.home.noNew'));
    expect(root.textContent).toContain('Weapons');
  });

  it('shows an error state when the home content fails to load', async () => {
    listProducts.mockRejectedValue(new Error('network down'));
    listCategories.mockRejectedValue(new Error('network down'));
    const root = document.createElement('div');
    const ctx = { cart: new CartController(), navigate: vi.fn() };
    root.innerHTML = homePage.render();
    homePage.mount?.(root, ctx);
    await flush();

    expect(root.querySelector('.store-error')).not.toBeNull();
  });
});
