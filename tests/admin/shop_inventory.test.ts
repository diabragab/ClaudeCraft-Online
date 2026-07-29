// @vitest-environment jsdom
import './_setup';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const inventoryRow = {
  id: 3,
  productId: 9,
  productSku: 'sword-01',
  productName: 'Iron Sword',
  quantityOnHand: 2,
  quantityReserved: 0,
  lowStockThreshold: 10,
  unlimited: false,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const inventoryPage = { rows: [inventoryRow], total: 1, page: 1, limit: 20 };
const productsPage = {
  rows: [{ id: 9, sku: 'sword-01', name: 'Iron Sword' }],
  total: 1,
  page: 1,
  limit: 100,
};

const apiGet = vi.fn(async (path: string) =>
  path.includes('/shop/products') ? productsPage : inventoryPage,
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
import ShopInventory from '../../src/admin/pages/ShopInventory.svelte';
import { grantPermissions } from './_grant';

beforeEach(() => {
  apiGet.mockClear();
  apiPost.mockReset();
  apiPost.mockResolvedValue({});
  grantPermissions();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

describe('ShopInventory', () => {
  it('lists tracked inventory and flags low stock', async () => {
    render(ShopInventory);
    // The same "sword-01 - Iron Sword" text also appears as a <select> option
    // in the "start tracking" picker, so target the row cell specifically.
    expect(await screen.findByRole('cell', { name: /sword-01 - Iron Sword/ })).toBeInTheDocument();
    expect(screen.getByText(t('shopInventory.lowStockBadge'))).toBeInTheDocument();
  });

  it('adjusts stock via POST to the plain :id path', async () => {
    render(ShopInventory);
    await screen.findByRole('cell', { name: /sword-01 - Iron Sword/ });
    await fireEvent.click(screen.getByRole('button', { name: t('shopCommon.edit') }));
    const qty = await screen.findByDisplayValue('2');
    await fireEvent.input(qty, { target: { value: '5' } });
    await fireEvent.click(screen.getByRole('button', { name: t('shopCommon.save') }));
    expect(apiPost).toHaveBeenCalledWith(
      '/admin/api/shop/inventory/3',
      expect.objectContaining({ quantityOnHand: 5 }),
    );
  });

  it('stops tracking a product via the /:id/delete suffix', async () => {
    render(ShopInventory);
    await screen.findByRole('cell', { name: /sword-01 - Iron Sword/ });
    await fireEvent.click(screen.getByRole('button', { name: t('shopInventory.stopTracking') }));
    expect(apiPost).toHaveBeenCalledWith('/admin/api/shop/inventory/3/delete', {});
  });

  it('hides the add form and row actions without shop.manage', async () => {
    grantPermissions(['analytics.read']);
    render(ShopInventory);
    await screen.findByRole('cell', { name: /sword-01 - Iron Sword/ });
    expect(screen.queryByText(t('shopInventory.addTitle'))).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: t('shopInventory.stopTracking') }),
    ).not.toBeInTheDocument();
  });
});
