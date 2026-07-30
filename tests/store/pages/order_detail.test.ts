// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getMyOrder = vi.fn();
vi.mock('../../../src/store/shop_api', () => ({
  getMyOrder: (...args: unknown[]) => getMyOrder(...args),
}));

import { orderDetailPage } from '../../../src/store/pages/order_detail';
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
  status: 'paid' as const,
  currency: 'gold' as const,
  totalAmount: 200,
  note: 'gift wrap please',
  createdByAdminId: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
  items: [
    { id: 1, productId: 1, productSku: 'sword-01', productName: 'Iron Sword', unitPrice: 100, quantity: 2, lineTotal: 200 },
  ],
  history: [
    { id: 1, fromStatus: null, toStatus: 'pending' as const, adminAccountId: null, note: '', createdAt: '2026-01-01T00:00:00.000Z' },
    { id: 2, fromStatus: 'pending' as const, toStatus: 'paid' as const, adminAccountId: 1, note: 'paid via wire', createdAt: '2026-01-02T00:00:00.000Z' },
  ],
};

beforeEach(() => {
  localStorage.clear();
  getMyOrder.mockReset();
});

describe('orderDetailPage', () => {
  it('shows a sign-in prompt with no session', () => {
    const root = document.createElement('div');
    root.innerHTML = orderDetailPage.render({ param: '5', cart: new CartController(), navigate: vi.fn() });
    expect(root.textContent).toContain(t('store.orders.signInRequiredBody'));
  });

  it('renders the order summary, items, and timeline', async () => {
    signIn();
    getMyOrder.mockResolvedValue(ORDER);
    const root = document.createElement('div');
    const ctx = { param: '5', cart: new CartController(), navigate: vi.fn() };
    root.innerHTML = orderDetailPage.render(ctx);
    orderDetailPage.mount?.(root, ctx);
    await flush();

    expect(root.textContent).toContain('Iron Sword');
    expect(root.querySelectorAll('.store-timeline li')).toHaveLength(2);
    expect(getMyOrder).toHaveBeenCalledWith(5);
  });

  it('shows an error state for a missing order', async () => {
    signIn();
    getMyOrder.mockRejectedValue(new Error('not found'));
    const root = document.createElement('div');
    const ctx = { param: '999', cart: new CartController(), navigate: vi.fn() };
    root.innerHTML = orderDetailPage.render(ctx);
    orderDetailPage.mount?.(root, ctx);
    await flush();

    expect(root.textContent).toContain(t('store.orderDetail.notFound'));
  });
});
