import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/ui/armory_inspect', () => ({
  ArmoryInspect: class {
    openSkinId: string | null = null;
    close(): void {}
    open(): void {}
    refresh(): void {}
  },
  badgeLabel: () => '',
  rarityLabel: () => '',
  weaponTypeLabel: () => '',
}));
vi.mock('../src/ui/portrait_chip', () => ({ portraitChipHtml: () => '' }));
// PackageInspect touches `document` (a real DOM); this suite runs in the
// plain Node env like the ArmoryInspect mock above, so it is stubbed rather
// than exercised for real. The stub captures its constructor deps and the
// package passed to open() so the tests below can assert on both.
const packageInspectState = vi.hoisted(() => ({
  deps: null as null | { requestBuy(pkg: unknown): void },
  openedWith: null as unknown,
}));
vi.mock('../src/ui/package_inspect', () => ({
  PackageInspect: class {
    constructor(deps: { requestBuy(pkg: unknown): void }) {
      packageInspectState.deps = deps;
    }
    open(pkg: unknown): void {
      packageInspectState.openedWith = pkg;
    }
    close(): void {}
  },
}));

import { DailyRewardsWindow } from '../src/ui/daily_rewards_window';
import { formatNumber } from '../src/ui/i18n';
import type { GeneralStoreCard, ShopCatalogProduct } from '../src/ui/woc_general_store_view';
import type { IWorld } from '../src/world_api';

function worldStub(): IWorld {
  return {
    player: { templateId: 'warrior', mainhandItemId: null },
    accountCosmetics: { weaponSkinIds: [], weaponSkinLoadout: {} },
  } as unknown as IWorld;
}

function rootStub(body: Record<string, unknown> | null = null): HTMLElement {
  const indicator = {
    classList: { toggle: vi.fn() },
    setAttribute: vi.fn(),
  };
  return {
    style: { display: 'block' },
    classList: { toggle: vi.fn(), add: vi.fn(), remove: vi.fn() },
    querySelector(selector: string) {
      if (selector === '.dr-body') return body;
      if (selector === '[data-woc-store-loading]') return indicator;
      return null;
    },
    querySelectorAll: () => [],
  } as unknown as HTMLElement;
}

function weaponSkinProduct(overrides: Partial<ShopCatalogProduct> = {}): ShopCatalogProduct {
  return {
    id: 1,
    sku: 'armory_cinderbrand_sword',
    name: 'Cinderbrand Sword',
    slug: 'armory-cinderbrand-sword',
    description: '',
    categoryId: null,
    priceClaudium: 200,
    icon: null,
    displayOrder: 0,
    status: 'active',
    featured: false,
    grantKind: 'weapon_skin',
    grantItemId: 'cinderbrand_sword',
    grantQuantity: 1,
    availability: 'unlimited',
    ...overrides,
  };
}

function weaponSkinCard(overrides: Partial<GeneralStoreCard> = {}): GeneralStoreCard {
  return {
    product: weaponSkinProduct(),
    grantKind: 'weapon_skin',
    weaponSkinId: 'cinderbrand_sword',
    owned: false,
    applied: false,
    canApplyNow: false,
    purchasable: true,
    affordable: true,
    shortfall: null,
    ...overrides,
  };
}

describe('DailyRewardsWindow store refresh behavior', () => {
  it('does not render wallet connection controls in the Store', () => {
    let html = '';
    const body = {
      dataset: {},
      get innerHTML() {
        return html;
      },
      set innerHTML(value: string) {
        html = value;
      },
      querySelector: () => null,
      querySelectorAll: () => [],
    };
    const window = new DailyRewardsWindow({
      root: () => rootStub(body),
      world: worldStub,
      closeOthers: () => undefined,
      captureFocus: () => null,
      restoreFocus: () => undefined,
    });
    Object.assign(window as unknown as Record<string, unknown>, {
      storeBalance: 750,
      storeCards: [],
    });

    (window as unknown as { paintStore(body: HTMLElement): void }).paintStore(
      body as unknown as HTMLElement,
    );

    expect(html).not.toContain('Connect wallet');
    expect(html).not.toContain('recovery phrase or private key');
    expect(html).not.toContain('data-store-wallet');
    expect(html).not.toContain('woc-store-wallet');
  });

  it('selects and opens the Store without toggling an open window closed', () => {
    const root = rootStub();
    root.style.display = 'none';
    const window = new DailyRewardsWindow({
      root: () => root,
      world: worldStub,
      closeOthers: () => undefined,
      captureFocus: () => null,
      restoreFocus: () => undefined,
      storeEnabled: () => true,
    });
    Object.assign(window as unknown as Record<string, unknown>, { tab: 'rewards' });
    const toggle = vi.spyOn(window, 'toggle').mockImplementation(() => undefined);

    window.openStore();

    expect(toggle).toHaveBeenCalledOnce();
    expect((window as unknown as { tab: string }).tab).toBe('store');

    root.style.display = 'block';
    toggle.mockClear();
    const renderCurrent = vi
      .spyOn(
        window as unknown as { renderCurrent(focus: 'open' | null): Promise<void> },
        'renderCurrent',
      )
      .mockResolvedValue();
    window.openStore();

    expect(toggle).not.toHaveBeenCalled();
    expect(renderCurrent).toHaveBeenCalledWith('open');
  });

  it('does not rebuild an unchanged store body during a background refresh', () => {
    let html = '';
    let writes = 0;
    const body = {
      dataset: {},
      get innerHTML() {
        return html;
      },
      set innerHTML(value: string) {
        html = value;
        writes += 1;
      },
      querySelector: () => null,
      querySelectorAll: () => [],
    };
    const window = new DailyRewardsWindow({
      root: () => rootStub(body),
      world: worldStub,
      closeOthers: () => undefined,
      captureFocus: () => null,
      restoreFocus: () => undefined,
    });
    Object.assign(window as unknown as Record<string, unknown>, {
      storeBalance: 750,
      storeCards: [],
    });

    const paintStore = (
      window as unknown as { paintStore(body: HTMLElement): void }
    ).paintStore.bind(window);
    paintStore(body as unknown as HTMLElement);
    paintStore(body as unknown as HTMLElement);

    expect(writes).toBe(1);
  });

  it('rebuilds the store body when its visible state changes', () => {
    let html = '';
    let writes = 0;
    const body = {
      dataset: {},
      get innerHTML() {
        return html;
      },
      set innerHTML(value: string) {
        html = value;
        writes += 1;
      },
      querySelector: () => null,
      querySelectorAll: () => [],
    };
    const window = new DailyRewardsWindow({
      root: () => rootStub(body),
      world: worldStub,
      closeOthers: () => undefined,
      captureFocus: () => null,
      restoreFocus: () => undefined,
    });
    Object.assign(window as unknown as Record<string, unknown>, {
      storeBalance: 750,
      storeCards: [],
    });

    const paintStore = (
      window as unknown as { paintStore(body: HTMLElement): void }
    ).paintStore.bind(window);
    paintStore(body as unknown as HTMLElement);
    Object.assign(window as unknown as Record<string, unknown>, { storeBalance: 1_250 });
    paintStore(body as unknown as HTMLElement);

    expect(writes).toBe(2);
    expect(html).toContain(formatNumber(1_250, { maximumFractionDigits: 0 }));
  });

  it('restores unchanged store markup after the rewards tab occupied the shared body', () => {
    let writes = 0;
    const body = {
      dataset: {},
      innerHTML: '',
      querySelector: () => null,
      querySelectorAll: () => [],
    };
    Object.defineProperty(body, 'innerHTML', {
      get: () => '',
      set: () => {
        writes += 1;
      },
    });
    const window = new DailyRewardsWindow({
      root: () => rootStub(body),
      world: worldStub,
      closeOthers: () => undefined,
      captureFocus: () => null,
      restoreFocus: () => undefined,
    });
    Object.assign(window as unknown as Record<string, unknown>, {
      storeBalance: 750,
      storeCards: [],
    });

    const paintStore = (
      window as unknown as { paintStore(body: HTMLElement): void }
    ).paintStore.bind(window);
    const paintRewards = (
      window as unknown as { paint(view: { kind: 'error'; message: string }): void }
    ).paint.bind(window);
    paintStore(body as unknown as HTMLElement);
    paintRewards({ kind: 'error', message: 'unavailable' });
    paintStore(body as unknown as HTMLElement);

    expect(writes).toBe(3);
  });

  it('preserves the last successful store state when a background snapshot is unavailable', async () => {
    const body = {
      innerHTML: 'existing store',
      querySelector: () => null,
      querySelectorAll: () => [],
    };
    const root = rootStub(body);
    const window = new DailyRewardsWindow({
      root: () => root,
      world: worldStub,
      closeOthers: () => undefined,
      captureFocus: () => null,
      restoreFocus: () => undefined,
      storeEnabled: () => true,
      catalogSnapshot: async () => ({
        available: false,
        balance: 100,
        categories: [],
        products: [],
      }),
    });
    Object.assign(window as unknown as Record<string, unknown>, {
      tab: 'store',
      storeReady: true,
      storeBalance: 750,
      storeProducts: [],
      storeCards: [],
    });

    await (window as unknown as { renderStore(focus: 'open' | null): Promise<void> }).renderStore(
      null,
    );

    expect((window as unknown as { storeBalance: number | null }).storeBalance).toBe(750);
    expect((window as unknown as { storeError: boolean }).storeError).toBe(false);
    expect(body.innerHTML).not.toContain('dr-error');
  });

  it('opens the need-more-Claudium dialog from an authoritative insufficient-balance response', async () => {
    const root = rootStub();
    const dialog: { body: string; onOk?: () => void } = { body: '' };
    const purchase = vi.fn(async () => ({
      ok: false,
      balance: 100,
      reason: 'insufficient_claudium',
    }));
    const window = new DailyRewardsWindow({
      root: () => root,
      world: worldStub,
      closeOthers: () => undefined,
      captureFocus: () => null,
      restoreFocus: () => undefined,
      purchase,
      confirmDialog: (_title, body, _ok, _cancel, onOk) => {
        dialog.body = body;
        dialog.onOk = onOk;
      },
    });
    const card = weaponSkinCard({ product: weaponSkinProduct({ id: 42, priceClaudium: 200 }) });

    await (
      window as unknown as { purchaseProduct(card: GeneralStoreCard): Promise<void> }
    ).purchaseProduct(card);

    expect(purchase).toHaveBeenCalledWith(42, 1);
    expect((window as unknown as { storeBalance: number | null }).storeBalance).toBe(100);
    // shortfall = 200 - 100 = 100 Claudium.
    expect(dialog.body).toContain(formatNumber(100, { maximumFractionDigits: 0 }));
    expect(dialog.body).toContain('Cinderbrand');
    // No external CTA anymore (gold is earned in-world, never purchased): OK
    // is purely dismissive and must not throw.
    expect(dialog.onOk).toBeTypeOf('function');
    expect(() => dialog.onOk?.()).not.toThrow();
  });

  it('opens the package inspect panel when a Packages tab card is clicked', () => {
    let capturedClick: (() => void) | undefined;
    const button = {
      dataset: { packageInspect: '5' },
      addEventListener: (type: string, cb: () => void) => {
        if (type === 'click') capturedClick = cb;
      },
    };
    const body = {
      dataset: {},
      innerHTML: '',
      querySelector: () => null,
      querySelectorAll: (selector: string) =>
        selector === '[data-package-inspect]' ? [button] : [],
    };
    const win = new DailyRewardsWindow({
      root: () => rootStub(body),
      world: worldStub,
      closeOthers: () => undefined,
      captureFocus: () => null,
      restoreFocus: () => undefined,
    });
    const pkg = {
      id: 5,
      name: 'Starter Pack',
      claudiumAmount: 500,
      bonusAmount: 0,
      price: 499,
      currency: 'USD',
      imageUrl: null,
      discountPercent: 0,
      featured: false,
    };
    Object.assign(win as unknown as Record<string, unknown>, { packages: [pkg] });

    (win as unknown as { paintPackages(body: HTMLElement): void }).paintPackages(
      body as unknown as HTMLElement,
    );

    expect(capturedClick).toBeTypeOf('function');
    capturedClick?.();
    expect(packageInspectState.openedWith).toEqual(pkg);
  });

  it("wires the package inspect panel's Buy action to open the web storefront in a new tab", () => {
    const button = {
      dataset: { packageInspect: '5' },
      addEventListener: (type: string, cb: () => void) => {
        if (type === 'click') cb();
      },
    };
    const body = {
      dataset: {},
      innerHTML: '',
      querySelector: () => null,
      querySelectorAll: (selector: string) =>
        selector === '[data-package-inspect]' ? [button] : [],
    };
    const win = new DailyRewardsWindow({
      root: () => rootStub(body),
      world: worldStub,
      closeOthers: () => undefined,
      captureFocus: () => null,
      restoreFocus: () => undefined,
    });
    const pkg = {
      id: 5,
      name: 'Starter Pack',
      claudiumAmount: 500,
      bonusAmount: 0,
      price: 499,
      currency: 'USD',
      imageUrl: null,
      discountPercent: 0,
      featured: false,
    };
    Object.assign(win as unknown as Record<string, unknown>, { packages: [pkg] });

    (win as unknown as { paintPackages(body: HTMLElement): void }).paintPackages(
      body as unknown as HTMLElement,
    );

    // Plain Node test env (tests/CLAUDE.md): no real `window` global, so stub
    // just the one property this handler touches.
    const openMock = vi.fn();
    vi.stubGlobal('window', { open: openMock });
    packageInspectState.deps?.requestBuy(pkg);
    expect(openMock).toHaveBeenCalledWith('/store/packages', '_blank', 'noopener,noreferrer');
    vi.unstubAllGlobals();
  });
});
