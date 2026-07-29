// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const listMyOrders = vi.fn();
vi.mock('../../../src/store/shop_api', () => ({
  listMyOrders: (...args: unknown[]) => listMyOrders(...args),
}));

import { ordersPage } from '../../../src/store/pages/orders';
import { CartController } from '../../../src/store/cart_controller';
import { t } from '../../../src/ui/i18n';

const SESSION_KEY = 'woc_session';
function signIn(): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify({ token: 'a'.repeat(64), username: 'playerOne' }));
}
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

const ORDER = {
  id: 5,
  accountId: 1,
  accountUsername: 'playerOne',
  status: 'pending' as const,
  currency: 'gold' as const,
  totalAmount: 200,
  note: '',
  createdByAdminId: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  items: [],
  history: [],
};

beforeEach(() => {
  localStorage.clear();
  listMyOrders.mockReset();
});

describe('ordersPage', () => {
  it('shows a sign-in prompt with no session', () => {
    const root = document.createElement('div');
    root.innerHTML = ordersPage.render({ cart: new CartController(), navigate: vi.fn() });
    expect(root.textContent).toContain(t('store.orders.signInRequiredBody'));
  });

  it('lists the order history when signed in', async () => {
    signIn();
    listMyOrders.mockResolvedValue({ rows: [ORDER], total: 1, page: 1, limit: 20 });
    const root = document.createElement('div');
    const ctx = { cart: new CartController(), navigate: vi.fn() };
    root.innerHTML = ordersPage.render(ctx);
    ordersPage.mount?.(root, ctx);
    await flush();

    expect(root.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(root.textContent).toContain('#5');
  });

  it('shows the empty state when there are no orders', async () => {
    signIn();
    listMyOrders.mockResolvedValue({ rows: [], total: 0, page: 1, limit: 20 });
    const root = document.createElement('div');
    const ctx = { cart: new CartController(), navigate: vi.fn() };
    root.innerHTML = ordersPage.render(ctx);
    ordersPage.mount?.(root, ctx);
    await flush();

    expect(root.textContent).toContain(t('store.orders.empty'));
  });
});
