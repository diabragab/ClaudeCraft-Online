// @vitest-environment jsdom
import './_setup';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const orderRow = {
  id: 5,
  accountId: 7,
  accountUsername: 'playerOne',
  status: 'pending' as const,
  currency: 'gold' as const,
  totalAmount: 200,
  note: 'phone order',
  createdByAdminId: 1,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const productRow = {
  id: 1,
  sku: 'sword-01',
  name: 'Iron Sword',
  slug: 'iron-sword',
  description: '',
  categoryId: null,
  priceGoldCopper: 100,
  priceClaudium: null,
  priceUsdCents: null,
  railSol: false,
  railUsdc: false,
  railWoc: false,
  status: 'active' as const,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const ordersPage = { rows: [orderRow], total: 1, page: 1, limit: 20 };
const productsPage = { rows: [productRow], total: 1, page: 1, limit: 100 };

const apiGet = vi.fn(async (path: string) =>
  path.includes('/shop/products') ? productsPage : ordersPage,
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
import ShopOrders from '../../src/admin/pages/ShopOrders.svelte';
import { grantPermissions } from './_grant';

beforeEach(() => {
  apiGet.mockClear();
  apiPost.mockReset();
  apiPost.mockResolvedValue({ id: 6 });
  grantPermissions();
});

describe('ShopOrders', () => {
  it('lists orders with a formatted total and status', async () => {
    render(ShopOrders);
    expect(await screen.findByText('playerOne')).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: t('shopOrders.statusPending') })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '#5' })).toBeInTheDocument();
  });

  it('creates an order from the new-order form', async () => {
    render(ShopOrders);
    await screen.findByText('playerOne');

    const accountInput = screen.getByLabelText(t('shopOrders.accountIdLabel'));
    await fireEvent.input(accountInput, { target: { value: '7' } });

    const productSelect = screen.getByLabelText(t('shopOrders.selectProduct'));
    await fireEvent.change(productSelect, { target: { value: '1' } });

    await fireEvent.click(screen.getByRole('button', { name: t('shopOrders.create') }));

    expect(apiPost).toHaveBeenCalledWith('/admin/api/shop/orders', {
      accountId: 7,
      currency: 'gold',
      items: [{ productId: 1, quantity: 1 }],
      note: '',
    });
  });

  it('hides the new-order form without shop.manage', async () => {
    grantPermissions(['analytics.read']);
    render(ShopOrders);
    await screen.findByText('playerOne');
    expect(screen.queryByText(t('shopOrders.newTitle'))).not.toBeInTheDocument();
  });

  it('filters by status via the query params sent to the list endpoint', async () => {
    render(ShopOrders);
    await screen.findByText('playerOne');
    apiGet.mockClear();
    const statusSelect = screen.getByDisplayValue(t('shopCommon.allStatuses'));
    await fireEvent.change(statusSelect, { target: { value: 'paid' } });
    expect(apiGet).toHaveBeenCalledWith(expect.stringContaining('status=paid'));
  });
});
