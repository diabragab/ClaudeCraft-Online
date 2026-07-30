// @vitest-environment jsdom
import './_setup';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const purchaseRow = {
  id: 9,
  accountId: 7,
  accountUsername: 'playerOne',
  packageId: 5,
  packageName: 'Starter Pack',
  claudiumAmount: 500,
  bonusAmount: 50,
  amountTotal: 499,
  currency: 'USD',
  status: 'paid' as const,
  stripeSessionId: 'cs_test_1',
  stripePaymentIntentId: 'pi_test_1',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const purchasesPage = { rows: [purchaseRow], total: 1, page: 1, limit: 20 };

const apiGet = vi.fn(async (_path: string) => purchasesPage);
vi.mock('../../src/admin/api', () => ({
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
  apiGet: (...a: unknown[]) => apiGet(...(a as [string])),
  apiPost: vi.fn(),
  getToken: () => 'tok',
  getAdminName: () => 'admin',
  clearSession: () => {},
}));

import { t } from '../../src/admin/i18n';
import ClaudiumPurchases from '../../src/admin/pages/ClaudiumPurchases.svelte';
import { grantPermissions } from './_grant';

beforeEach(() => {
  apiGet.mockClear();
  grantPermissions();
});

describe('ClaudiumPurchases', () => {
  it('lists purchases with the account, package, Claudium total, and status', async () => {
    render(ClaudiumPurchases);
    expect(await screen.findByText('playerOne')).toBeInTheDocument();
    expect(screen.getByText('Starter Pack')).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '#9' })).toBeInTheDocument();
    expect(screen.getByText('550 (500+50)')).toBeInTheDocument();
    expect(screen.getByText('$4.99 USD')).toBeInTheDocument();
    expect(
      screen.getByRole('cell', { name: t('claudiumPurchases.statusPaid') }),
    ).toBeInTheDocument();
    expect(screen.getByText('cs_test_1')).toBeInTheDocument();
  });

  it('shows the empty state with no purchases', async () => {
    apiGet.mockResolvedValueOnce({ rows: [], total: 0, page: 1, limit: 20 });
    render(ClaudiumPurchases);
    expect(await screen.findByText(t('claudiumPurchases.empty'))).toBeInTheDocument();
  });

  it('filters by status via the query params sent to the list endpoint', async () => {
    render(ClaudiumPurchases);
    await screen.findByText('playerOne');
    apiGet.mockClear();
    const statusSelect = screen.getByDisplayValue(t('shopCommon.allStatuses'));
    await fireEvent.change(statusSelect, { target: { value: 'failed' } });
    expect(apiGet).toHaveBeenCalledWith(expect.stringContaining('status=failed'));
  });

  it('filters by accountId via the query params sent to the list endpoint', async () => {
    render(ClaudiumPurchases);
    await screen.findByText('playerOne');
    apiGet.mockClear();
    const accountInput = screen.getByPlaceholderText(t('claudiumPurchases.filterAccountId'));
    await fireEvent.input(accountInput, { target: { value: '7' } });
    await fireEvent.change(accountInput);
    expect(apiGet).toHaveBeenCalledWith(expect.stringContaining('accountId=7'));
  });
});
