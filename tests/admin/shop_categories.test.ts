// @vitest-environment jsdom
import './_setup';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const categoryRow = {
  id: 1,
  name: 'Weapons',
  slug: 'weapons',
  description: '',
  parentId: null,
  sortOrder: 0,
  status: 'active' as const,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const listPage = { rows: [categoryRow], total: 1, page: 1, limit: 20 };
const parentOptionsPage = { rows: [categoryRow], total: 1, page: 1, limit: 100 };

const apiGet = vi.fn(async (path: string) =>
  path.includes('limit=100') ? parentOptionsPage : listPage,
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
import ShopCategories from '../../src/admin/pages/ShopCategories.svelte';
import { grantPermissions } from './_grant';

beforeEach(() => {
  apiGet.mockClear();
  apiPost.mockReset();
  apiPost.mockResolvedValue({});
  grantPermissions();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

describe('ShopCategories', () => {
  it('lists categories', async () => {
    render(ShopCategories);
    // "Weapons" also appears as a parent-picker <option>, so target the row cell.
    expect(await screen.findByRole('cell', { name: 'Weapons' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'weapons' })).toBeInTheDocument();
  });

  it('creates a category from the add form', async () => {
    render(ShopCategories);
    await screen.findByRole('cell', { name: 'Weapons' });
    await fireEvent.input(screen.getByPlaceholderText(t('shopCategories.namePlaceholder')), {
      target: { value: 'Armor' },
    });
    await fireEvent.input(screen.getByPlaceholderText(t('shopCategories.slugPlaceholder')), {
      target: { value: 'armor' },
    });
    // "Add category" is also the panel title; the button is the interactive element.
    await fireEvent.click(screen.getByRole('button', { name: t('shopCategories.add') }));
    expect(apiPost).toHaveBeenCalledWith(
      '/admin/api/shop/categories',
      expect.objectContaining({ name: 'Armor', slug: 'armor', parentId: 0 }),
    );
  });

  it('deletes a category via the /:id/delete suffix', async () => {
    render(ShopCategories);
    await screen.findByRole('cell', { name: 'Weapons' });
    await fireEvent.click(screen.getByRole('button', { name: t('shopCommon.delete') }));
    expect(apiPost).toHaveBeenCalledWith('/admin/api/shop/categories/1/delete', {});
  });

  it('hides the add form and row actions without shop.manage', async () => {
    grantPermissions(['analytics.read']);
    render(ShopCategories);
    await screen.findByRole('cell', { name: 'Weapons' });
    expect(screen.queryByText(t('shopCategories.addTitle'))).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('shopCommon.delete') })).not.toBeInTheDocument();
  });
});
