// @vitest-environment jsdom
import './_setup';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

function orderDetail(overrides: Record<string, unknown> = {}) {
  return {
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
    items: [
      {
        id: 1,
        productId: 1,
        productSku: 'sword-01',
        productName: 'Iron Sword',
        unitPrice: 100,
        quantity: 2,
        lineTotal: 200,
      },
    ],
    history: [
      {
        id: 1,
        fromStatus: null,
        toStatus: 'pending' as const,
        adminAccountId: 1,
        note: '',
        createdAt: '2026-01-01T00:00:00Z',
      },
    ],
    ...overrides,
  };
}

let currentOrder = orderDetail();
const apiGet = vi.fn(async (..._args: unknown[]) => currentOrder);
const apiPost = vi.fn();
vi.mock('../../src/admin/api', () => ({
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
  apiGet: (...a: unknown[]) => apiGet(...a),
  apiPost: (...a: unknown[]) => apiPost(...(a as [string, unknown])),
  getToken: () => 'tok',
  getAdminName: () => 'admin',
  clearSession: () => {},
}));

import { t } from '../../src/admin/i18n';
import ShopOrderDetail from '../../src/admin/pages/ShopOrderDetail.svelte';
import { grantPermissions } from './_grant';

beforeEach(() => {
  currentOrder = orderDetail();
  apiGet.mockClear();
  apiPost.mockReset();
  apiPost.mockResolvedValue(orderDetail({ status: 'paid' }));
  grantPermissions();
});

describe('ShopOrderDetail', () => {
  it('shows the order summary, items, and timeline', async () => {
    render(ShopOrderDetail, { props: { id: 5 } });
    expect(await screen.findByText('playerOne', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('Iron Sword')).toBeInTheDocument();
    expect(screen.getByText('sword-01')).toBeInTheDocument();
    expect(screen.getByText(t('shopOrders.statusPending'), { exact: true })).toBeInTheDocument();
  });

  it('offers Mark paid and Cancel for a pending order', async () => {
    render(ShopOrderDetail, { props: { id: 5 } });
    await screen.findByText('Iron Sword');
    expect(
      screen.getByRole('button', { name: t('shopOrders.actionMarkPaid') }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t('shopOrders.actionCancel') })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: t('shopOrders.actionRefund') }),
    ).not.toBeInTheDocument();
  });

  it('offers Mark fulfilled, Cancel, and Refund for a paid order', async () => {
    currentOrder = orderDetail({ status: 'paid' });
    render(ShopOrderDetail, { props: { id: 5 } });
    await screen.findByText('Iron Sword');
    expect(
      screen.getByRole('button', { name: t('shopOrders.actionMarkFulfilled') }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t('shopOrders.actionCancel') })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t('shopOrders.actionRefund') })).toBeInTheDocument();
  });

  it('offers no actions for a cancelled (terminal) order', async () => {
    currentOrder = orderDetail({ status: 'cancelled' });
    render(ShopOrderDetail, { props: { id: 5 } });
    await screen.findByText('Iron Sword');
    expect(screen.queryByRole('button', { name: /Mark|Cancel|Refund/ })).not.toBeInTheDocument();
  });

  it('marks an order paid with the action note', async () => {
    render(ShopOrderDetail, { props: { id: 5 } });
    await screen.findByText('Iron Sword');
    await fireEvent.input(screen.getByLabelText(t('shopOrders.actionNoteLabel')), {
      target: { value: 'paid via wire' },
    });
    await fireEvent.click(screen.getByRole('button', { name: t('shopOrders.actionMarkPaid') }));
    expect(apiPost).toHaveBeenCalledWith('/admin/api/shop/orders/5/status', {
      status: 'paid',
      note: 'paid via wire',
    });
  });

  it('cancels an order', async () => {
    render(ShopOrderDetail, { props: { id: 5 } });
    await screen.findByText('Iron Sword');
    await fireEvent.click(screen.getByRole('button', { name: t('shopOrders.actionCancel') }));
    expect(apiPost).toHaveBeenCalledWith('/admin/api/shop/orders/5/cancel', { note: '' });
  });

  it('hides action buttons without shop.manage', async () => {
    grantPermissions(['analytics.read']);
    render(ShopOrderDetail, { props: { id: 5 } });
    await screen.findByText('Iron Sword');
    expect(
      screen.queryByRole('button', { name: t('shopOrders.actionMarkPaid') }),
    ).not.toBeInTheDocument();
  });

  it('shows the created-order timeline entry', async () => {
    render(ShopOrderDetail, { props: { id: 5 } });
    await screen.findByText('Iron Sword');
    expect(
      screen.getByText(t('shopOrders.timelineCreated', { status: t('shopOrders.statusPending') })),
    ).toBeInTheDocument();
  });
});
