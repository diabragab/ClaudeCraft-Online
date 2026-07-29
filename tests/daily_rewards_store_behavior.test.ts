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

import { DailyRewardsWindow } from '../src/ui/daily_rewards_window';
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
    querySelector(selector: string) {
      if (selector === '.dr-body') return body;
      if (selector === '[data-woc-store-loading]') return indicator;
      return null;
    },
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
    expect(html).toContain('1,250');
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

  it('opens the top-up dialog from an authoritative insufficient-balance response', async () => {
    const root = rootStub();
    const dialog: { body: string; onOk?: () => void } = { body: '' };
    const order: string[] = [];
    const openClaudium = vi.fn(() => order.push('claudium'));
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
      openClaudium,
      confirmDialog: (_title, body, _ok, _cancel, onOk) => {
        dialog.body = body;
        dialog.onOk = onOk;
      },
    });
    const card = weaponSkinCard({ product: weaponSkinProduct({ id: 42, priceClaudium: 200 }) });
    Object.assign(window as unknown as Record<string, unknown>, {
      armoryInspect: { close: () => order.push('inspect') },
    });

    await (
      window as unknown as { purchaseProduct(card: GeneralStoreCard): Promise<void> }
    ).purchaseProduct(card);

    expect(purchase).toHaveBeenCalledWith(42, 1);
    expect((window as unknown as { storeBalance: number | null }).storeBalance).toBe(100);
    expect(dialog.body).toContain('100');
    expect(dialog.body).toContain('Cinderbrand');
    expect(dialog.onOk).toBeTypeOf('function');
    dialog.onOk?.();
    expect(openClaudium).toHaveBeenCalledOnce();
    expect(order).toEqual(['inspect', 'claudium']);
  });

  it('refreshes and requires a new confirmation when the price changed', async () => {
    const confirmations: string[] = [];
    const purchase = vi.fn(async () => ({ ok: false, balance: 2_000, reason: 'price_changed' }));
    const window = new DailyRewardsWindow({
      root: () => rootStub(),
      world: worldStub,
      closeOthers: () => undefined,
      captureFocus: () => null,
      restoreFocus: () => undefined,
      purchase,
      confirmDialog: (_title, body) => confirmations.push(body),
    });
    const original = weaponSkinCard({
      product: weaponSkinProduct({ id: 7, priceClaudium: 200 }),
      affordable: true,
    });
    const current = weaponSkinCard({
      product: weaponSkinProduct({ id: 7, priceClaudium: 1_000 }),
      affordable: true,
    });
    Object.assign(window as unknown as Record<string, unknown>, {
      storeCards: [],
      renderStore: async () => {
        Object.assign(window as unknown as Record<string, unknown>, { storeCards: [current] });
      },
    });

    await (
      window as unknown as { purchaseProduct(card: GeneralStoreCard): Promise<void> }
    ).purchaseProduct(original);

    expect(purchase).toHaveBeenCalledWith(7, 1);
    expect(confirmations).toHaveLength(1);
    expect(confirmations[0]).toContain('1,000');
  });
});
