// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getPurchaseStatus = vi.fn();
vi.mock('../../../src/store/shop_api', () => ({
  getPurchaseStatus: (...args: unknown[]) => getPurchaseStatus(...args),
}));

import { packageConfirmationPage } from '../../../src/store/pages/package_confirmation';
import { t } from '../../../src/ui/i18n';

function setUrl(search: string): void {
  window.history.pushState({}, '', `/store/packages/confirmation${search}`);
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function purchase(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 9,
    accountId: 7,
    packageId: 5,
    packageName: 'Starter Pack',
    claudiumAmount: 500,
    bonusAmount: 50,
    amountTotal: 499,
    currency: 'USD',
    status: 'paid',
    stripeSessionId: 'cs_test_1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  getPurchaseStatus.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('packageConfirmationPage', () => {
  it('shows a missing-session message with no session_id in the URL', () => {
    setUrl('');
    const root = document.createElement('div');
    root.innerHTML = packageConfirmationPage.render();
    expect(root.textContent).toContain(t('store.packageConfirmation.missingSession'));
  });

  it('shows the paid confirmation with the total Claudium credited', async () => {
    setUrl('?session_id=cs_test_1');
    getPurchaseStatus.mockResolvedValue(purchase({ status: 'paid' }));
    const root = document.createElement('div');
    root.innerHTML = packageConfirmationPage.render();
    const cleanup = packageConfirmationPage.mount?.(root, {
      cart: undefined as never,
      navigate: vi.fn(),
    });
    await flush();

    expect(getPurchaseStatus).toHaveBeenCalledWith('cs_test_1');
    expect(root.textContent).toContain(t('store.packageConfirmation.paidTitle'));
    expect(root.textContent).toContain(
      t('store.packageConfirmation.paidBody', { amount: 550, package: 'Starter Pack' }),
    );
    cleanup?.();
  });

  it('shows the failed state for an expired purchase', async () => {
    setUrl('?session_id=cs_test_2');
    getPurchaseStatus.mockResolvedValue(purchase({ status: 'expired' }));
    const root = document.createElement('div');
    root.innerHTML = packageConfirmationPage.render();
    const cleanup = packageConfirmationPage.mount?.(root, {
      cart: undefined as never,
      navigate: vi.fn(),
    });
    await flush();

    expect(root.textContent).toContain(t('store.packageConfirmation.failedTitle'));
    cleanup?.();
  });

  it('polls while pending, then shows paid once the webhook catches up', async () => {
    vi.useFakeTimers();
    setUrl('?session_id=cs_test_3');
    getPurchaseStatus
      .mockResolvedValueOnce(purchase({ status: 'pending' }))
      .mockResolvedValueOnce(purchase({ status: 'paid' }));
    const root = document.createElement('div');
    root.innerHTML = packageConfirmationPage.render();
    const cleanup = packageConfirmationPage.mount?.(root, {
      cart: undefined as never,
      navigate: vi.fn(),
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(root.textContent).toContain(t('store.packageConfirmation.pendingTitle'));
    expect(getPurchaseStatus).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2000);
    expect(getPurchaseStatus).toHaveBeenCalledTimes(2);
    expect(root.textContent).toContain(t('store.packageConfirmation.paidTitle'));
    cleanup?.();
  });
});
