// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const listCategories = vi.fn();
vi.mock('../../../src/store/shop_api', () => ({
  listCategories: (...args: unknown[]) => listCategories(...args),
}));

import { categoriesPage } from '../../../src/store/pages/categories';
import { CartController } from '../../../src/store/cart_controller';
import { t } from '../../../src/ui/i18n';

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  listCategories.mockReset();
});

describe('categoriesPage', () => {
  it('lists every category as a tile', async () => {
    listCategories.mockResolvedValue({
      rows: [
        { id: 1, name: 'Weapons', slug: 'weapons', description: 'Blades and bows', parentId: null, sortOrder: 0, status: 'active', createdAt: '', updatedAt: '' },
      ],
      total: 1,
      page: 1,
      limit: 100,
    });
    const root = document.createElement('div');
    const ctx = { cart: new CartController(), navigate: vi.fn() };
    root.innerHTML = categoriesPage.render();
    categoriesPage.mount?.(root, ctx);
    await flush();

    expect(root.textContent).toContain('Weapons');
    expect(root.querySelector('a.store-category-tile')?.getAttribute('href')).toBe(
      '/store/categories/weapons',
    );
  });

  it('shows the empty state with no categories', async () => {
    listCategories.mockResolvedValue({ rows: [], total: 0, page: 1, limit: 100 });
    const root = document.createElement('div');
    const ctx = { cart: new CartController(), navigate: vi.fn() };
    root.innerHTML = categoriesPage.render();
    categoriesPage.mount?.(root, ctx);
    await flush();

    expect(root.textContent).toContain(t('store.categories.empty'));
  });
});
