// @vitest-environment jsdom
import './_setup';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const packageRow = {
  id: 5,
  name: 'Starter Pack',
  claudiumAmount: 500,
  bonusAmount: 50,
  price: 499,
  currency: 'USD',
  stripePriceId: null,
  enabled: true,
  displayOrder: 0,
  imageUrl: 'https://example.com/pack.png',
  discountPercent: 20,
  featured: true,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const packagesPage = { rows: [packageRow], total: 1, page: 1, limit: 20 };

const apiGet = vi.fn(async (_path: string) => packagesPage);
const apiPost = vi.fn(async (_path: string, _body: unknown) => ({ id: 6 }));
vi.mock('../../src/admin/api', () => ({
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
  apiGet: (...a: unknown[]) => apiGet(...(a as [string])),
  apiPost: (...a: unknown[]) => apiPost(...(a as [string, unknown])),
  getToken: () => 'tok',
  getAdminName: () => 'admin',
  clearSession: () => {},
}));

import { t } from '../../src/admin/i18n';
import ClaudiumPackages from '../../src/admin/pages/ClaudiumPackages.svelte';
import { grantPermissions } from './_grant';

beforeEach(() => {
  apiGet.mockClear();
  apiPost.mockClear();
  grantPermissions();
});

describe('ClaudiumPackages', () => {
  it('lists packages with their discount and featured columns', async () => {
    render(ClaudiumPackages);
    expect(await screen.findByText('Starter Pack')).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '20%' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: t('shopCommon.yes') })).toBeInTheDocument();
  });

  it('shows a hyphen (never an em/en dash) when a package has no discount', async () => {
    apiGet.mockResolvedValueOnce({
      rows: [{ ...packageRow, discountPercent: 0 }],
      total: 1,
      page: 1,
      limit: 20,
    });
    render(ClaudiumPackages);
    await screen.findByText('Starter Pack');
    expect(screen.getByRole('cell', { name: '-' })).toBeInTheDocument();
  });

  it('creates a package including imageUrl, discountPercent, and featured', async () => {
    render(ClaudiumPackages);
    await screen.findByText('Starter Pack');

    await fireEvent.input(screen.getByLabelText(t('claudiumPackages.nameLabel')), {
      target: { value: 'Bulk Pack' },
    });
    await fireEvent.input(screen.getByLabelText(t('claudiumPackages.claudiumAmountLabel')), {
      target: { value: '1000' },
    });
    await fireEvent.input(screen.getByLabelText(t('claudiumPackages.priceLabel')), {
      target: { value: '999' },
    });
    await fireEvent.input(screen.getByLabelText(t('claudiumPackages.imageUrlLabel')), {
      target: { value: 'https://example.com/bulk.png' },
    });
    await fireEvent.input(screen.getByLabelText(t('claudiumPackages.discountPercentLabel')), {
      target: { value: '15' },
    });
    await fireEvent.click(screen.getByLabelText(t('claudiumPackages.featuredLabel')));

    await fireEvent.click(screen.getByRole('button', { name: t('claudiumPackages.add') }));

    expect(apiPost).toHaveBeenCalledWith(
      '/admin/api/shop/packages',
      expect.objectContaining({
        name: 'Bulk Pack',
        claudiumAmount: 1000,
        price: 999,
        imageUrl: 'https://example.com/bulk.png',
        discountPercent: 15,
        featured: true,
      }),
    );
  });

  it('opens the edit modal pre-filled with the merchandising fields', async () => {
    render(ClaudiumPackages);
    await screen.findByText('Starter Pack');

    await fireEvent.click(screen.getByRole('button', { name: t('shopCommon.edit') }));

    const modal = within(screen.getByRole('dialog'));
    expect(modal.getByDisplayValue('https://example.com/pack.png')).toBeInTheDocument();
    expect(modal.getByDisplayValue('20')).toBeInTheDocument();
    expect(modal.getByLabelText(t('claudiumPackages.featuredLabel'))).toBeChecked();
  });

  it('hides the create form without shop.manage', async () => {
    grantPermissions(['analytics.read']);
    render(ClaudiumPackages);
    await screen.findByText('Starter Pack');
    expect(screen.queryByText(t('claudiumPackages.addTitle'))).not.toBeInTheDocument();
  });
});
