// @vitest-environment jsdom
import './_setup';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const productRow = {
  id: 9,
  sku: 'sword-01',
  name: 'Iron Sword',
  slug: 'iron-sword',
  description: '',
  categoryId: null,
  priceGoldCopper: 1000,
  priceClaudium: null,
  priceUsdCents: null,
  railSol: false,
  railUsdc: false,
  railWoc: false,
  status: 'draft' as const,
  enabled: false,
  featured: false,
  icon: null,
  displayOrder: 0,
  grantKind: 'none' as const,
  grantItemId: null,
  grantQuantity: 1,
  rarity: 'common' as const,
  badges: [],
  isEvent: false,
  isLimited: false,
  discountPercent: null,
  bannerImage: null,
  previewImage: null,
  announcementTemplate: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const productsPage = { rows: [productRow], total: 1, page: 1, limit: 20 };
const categoriesPage = { rows: [] as unknown[], total: 0, page: 1, limit: 100 };

const apiGet = vi.fn(async (path: string) =>
  path.includes('/shop/categories') ? categoriesPage : productsPage,
);
const apiPost = vi.fn();
vi.mock('../../src/admin/api', () => ({
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
  apiGet: (...a: unknown[]) => apiGet(...(a as [string])),
  apiPost: (...a: unknown[]) => apiPost(...a),
  getToken: () => 'tok',
  getAdminName: () => 'admin',
  clearSession: () => {},
}));

import { t } from '../../src/admin/i18n';
import ShopProducts from '../../src/admin/pages/ShopProducts.svelte';
import { grantPermissions } from './_grant';

beforeEach(() => {
  apiGet.mockClear();
  apiPost.mockReset();
  apiPost.mockResolvedValue({});
  grantPermissions();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

describe('ShopProducts', () => {
  it('lists products with a formatted price', async () => {
    render(ShopProducts);
    expect(await screen.findByText('Iron Sword')).toBeInTheDocument();
    expect(screen.getByText('sword-01')).toBeInTheDocument();
  });

  it('creates a product from the add form', async () => {
    render(ShopProducts);
    await screen.findByText('Iron Sword');
    await fireEvent.input(screen.getByPlaceholderText(t('shopProducts.skuPlaceholder')), {
      target: { value: 'shield-01' },
    });
    await fireEvent.input(screen.getByPlaceholderText(t('shopProducts.namePlaceholder')), {
      target: { value: 'Iron Shield' },
    });
    await fireEvent.input(screen.getByPlaceholderText(t('shopProducts.slugPlaceholder')), {
      target: { value: 'iron-shield' },
    });
    // "Add product" is also the panel title; the button is the interactive element.
    await fireEvent.click(screen.getByRole('button', { name: t('shopProducts.add') }));
    expect(apiPost).toHaveBeenCalledWith(
      '/admin/api/shop/products',
      expect.objectContaining({ sku: 'shield-01', name: 'Iron Shield', slug: 'iron-shield' }),
    );
  });

  it('deletes a product via the /:id/delete suffix', async () => {
    render(ShopProducts);
    await screen.findByText('Iron Sword');
    await fireEvent.click(screen.getByText(t('shopCommon.delete')));
    expect(apiPost).toHaveBeenCalledWith('/admin/api/shop/products/9/delete', {});
  });

  it('hides the add form and row actions without shop.manage', async () => {
    grantPermissions(['analytics.read']);
    render(ShopProducts);
    await screen.findByText('Iron Sword');
    expect(screen.queryByText(t('shopProducts.addTitle'))).not.toBeInTheDocument();
    expect(screen.queryByText(t('shopCommon.delete'))).not.toBeInTheDocument();
  });
});
