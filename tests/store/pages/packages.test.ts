// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const listPackages = vi.fn();
const startPackageCheckout = vi.fn();
vi.mock('../../../src/store/shop_api', () => ({
  listPackages: (...args: unknown[]) => listPackages(...args),
  startPackageCheckout: (...args: unknown[]) => startPackageCheckout(...args),
}));

import { CartController } from '../../../src/store/cart_controller';
import { packagesPage } from '../../../src/store/pages/packages';
import { t } from '../../../src/ui/i18n';

const SESSION_KEY = 'woc_session';

function signIn(): void {
  localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({ token: 'a'.repeat(64), username: 'playerOne' }),
  );
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function packageRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 5,
    name: 'Starter Pack',
    claudiumAmount: 500,
    bonusAmount: 0,
    price: 499,
    currency: 'USD',
    enabled: true,
    displayOrder: 0,
    imageUrl: null,
    discountPercent: 0,
    featured: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
  listPackages.mockReset();
  startPackageCheckout.mockReset();
});

describe('packagesPage', () => {
  it('shows a sign-in prompt when there is no session', () => {
    const root = document.createElement('div');
    root.innerHTML = packagesPage.render();
    expect(root.textContent).toContain(t('store.packages.signInRequiredBody'));
  });

  it('lists packages with bonus, discount, and featured badges', async () => {
    signIn();
    listPackages.mockResolvedValue({
      rows: [packageRow({ bonusAmount: 50, discountPercent: 20, featured: true })],
      total: 1,
      page: 1,
      limit: 100,
    });
    const root = document.createElement('div');
    const ctx = { cart: new CartController(), navigate: vi.fn() };
    root.innerHTML = packagesPage.render();
    packagesPage.mount?.(root, ctx);
    await flush();

    expect(root.textContent).toContain('Starter Pack');
    expect(root.textContent).toContain(t('store.packages.featuredBadge'));
    expect(root.textContent).toContain(t('store.packages.discountBadge', { percent: 20 }));
    expect(root.textContent).toContain(t('store.packages.bonusLabel', { amount: 50 }));
  });

  it('shows the empty state with no packages', async () => {
    signIn();
    listPackages.mockResolvedValue({ rows: [], total: 0, page: 1, limit: 100 });
    const root = document.createElement('div');
    const ctx = { cart: new CartController(), navigate: vi.fn() };
    root.innerHTML = packagesPage.render();
    packagesPage.mount?.(root, ctx);
    await flush();

    expect(root.textContent).toContain(t('store.packages.empty'));
  });

  it('starts checkout and redirects to the returned Stripe url on Buy', async () => {
    signIn();
    listPackages.mockResolvedValue({ rows: [packageRow()], total: 1, page: 1, limit: 100 });
    startPackageCheckout.mockResolvedValue({
      url: 'https://checkout.stripe.com/cs_test_1',
      sessionId: 'cs_test_1',
    });
    const root = document.createElement('div');
    const ctx = { cart: new CartController(), navigate: vi.fn() };
    root.innerHTML = packagesPage.render();
    packagesPage.mount?.(root, ctx);
    await flush();

    // jsdom's real navigation is not implemented; replace location with a plain
    // object so the redirect assignment is observable instead of throwing.
    Object.defineProperty(window, 'location', { value: { href: '' }, writable: true });

    const button = root.querySelector<HTMLButtonElement>('[data-buy-package="5"]');
    button?.click();
    await flush();

    expect(startPackageCheckout).toHaveBeenCalledWith(5);
    expect(window.location.href).toBe('https://checkout.stripe.com/cs_test_1');
  });

  it('shows an inline error and re-enables Buy when checkout fails', async () => {
    signIn();
    listPackages.mockResolvedValue({ rows: [packageRow()], total: 1, page: 1, limit: 100 });
    startPackageCheckout.mockRejectedValue(new Error('boom'));
    const root = document.createElement('div');
    const ctx = { cart: new CartController(), navigate: vi.fn() };
    root.innerHTML = packagesPage.render();
    packagesPage.mount?.(root, ctx);
    await flush();

    const button = root.querySelector<HTMLButtonElement>('[data-buy-package="5"]');
    button?.click();
    await flush();

    expect(root.querySelector('.store-package-status')?.textContent).toBe(
      t('store.packages.checkoutFailed'),
    );
    expect(button?.disabled).toBe(false);
  });
});
