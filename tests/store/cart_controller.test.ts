import { beforeEach, describe, expect, it } from 'vitest';
import { CartController } from '../../src/store/cart_controller';

function installStorage(): void {
  const map = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
    clear: () => map.clear(),
    key: () => null,
    length: 0,
  };
}

beforeEach(() => installStorage());

const SWORD = { productId: 1, slug: 'iron-sword', name: 'Iron Sword', unitPrice: 100 };

describe('CartController', () => {
  it('starts from whatever is in storage (empty by default)', () => {
    const controller = new CartController();
    expect(controller.getState()).toEqual({ currency: null, items: [] });
  });

  it('persists an add across a fresh controller instance', () => {
    const first = new CartController();
    first.add(SWORD, 2, 'gold');
    const second = new CartController();
    expect(second.getState()).toEqual({ currency: 'gold', items: [{ ...SWORD, quantity: 2 }] });
  });

  it('notifies subscribers on every mutation', () => {
    const controller = new CartController();
    const seen: number[] = [];
    controller.subscribe((state) => seen.push(state.items.length));
    controller.add(SWORD, 1, 'gold');
    controller.remove(1);
    expect(seen).toEqual([1, 0]);
  });

  it('stops notifying after unsubscribe', () => {
    const controller = new CartController();
    let calls = 0;
    const unsubscribe = controller.subscribe(() => {
      calls += 1;
    });
    controller.add(SWORD, 1, 'gold');
    unsubscribe();
    controller.remove(1);
    expect(calls).toBe(1);
  });

  it('propagates a currency_mismatch rejection without mutating state', () => {
    const controller = new CartController();
    controller.add(SWORD, 1, 'gold');
    const result = controller.add({ ...SWORD, productId: 2 }, 1, 'usd');
    expect(result).toEqual({ ok: false, error: 'currency_mismatch' });
    expect(controller.getState().items).toHaveLength(1);
  });

  it('clear() empties the cart and the persisted copy', () => {
    const controller = new CartController();
    controller.add(SWORD, 1, 'gold');
    controller.clear();
    expect(controller.getState()).toEqual({ currency: null, items: [] });
    expect(new CartController().getState()).toEqual({ currency: null, items: [] });
  });

  it('updateQuantity updates a line and persists it', () => {
    const controller = new CartController();
    controller.add(SWORD, 1, 'gold');
    const result = controller.updateQuantity(1, 5);
    expect(result).toEqual({ ok: true });
    expect(controller.getState().items[0].quantity).toBe(5);
  });
});
