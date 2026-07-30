import { beforeEach, describe, expect, it } from 'vitest';
import { EMPTY_CART } from '../../src/store/cart';
import { clearStoredCart, loadCart, saveCart } from '../../src/store/cart_storage';

// Minimal localStorage stub (the test env is plain node, no DOM), mirroring
// tests/keybinds.test.ts's installStorage.
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

const IRON_SWORD = { productId: 1, slug: 'iron-sword', name: 'Iron Sword', unitPrice: 100 };
const WOODEN_SHIELD = { productId: 2, slug: 'wooden-shield', name: 'Wooden Shield', unitPrice: 50 };

describe('loadCart / saveCart', () => {
  it('returns the empty cart when nothing is stored', () => {
    expect(loadCart()).toEqual(EMPTY_CART);
  });

  it('round-trips a saved cart', () => {
    const cart = { currency: 'gold' as const, items: [{ ...IRON_SWORD, quantity: 2 }] };
    saveCart(cart);
    expect(loadCart()).toEqual(cart);
  });

  it('falls back to empty on malformed JSON', () => {
    localStorage.setItem('woc_store_cart', 'not json');
    expect(loadCart()).toEqual(EMPTY_CART);
  });

  it('drops a malformed item (non-integer / non-positive quantity) rather than throwing', () => {
    localStorage.setItem(
      'woc_store_cart',
      JSON.stringify({
        currency: 'gold',
        items: [{ ...IRON_SWORD, quantity: 2 }, { ...WOODEN_SHIELD, quantity: -1 }],
      }),
    );
    expect(loadCart()).toEqual({ currency: 'gold', items: [{ ...IRON_SWORD, quantity: 2 }] });
  });

  it('drops an item missing a display-snapshot field (slug/name/unitPrice)', () => {
    localStorage.setItem(
      'woc_store_cart',
      JSON.stringify({
        currency: 'gold',
        items: [{ productId: 1, quantity: 2 }, { ...IRON_SWORD, quantity: 1 }],
      }),
    );
    expect(loadCart()).toEqual({ currency: 'gold', items: [{ ...IRON_SWORD, quantity: 1 }] });
  });

  it('normalizes an unrecognized currency to null', () => {
    localStorage.setItem(
      'woc_store_cart',
      JSON.stringify({ currency: 'euros', items: [{ ...IRON_SWORD, quantity: 1 }] }),
    );
    expect(loadCart().currency).toBeNull();
  });
});

describe('clearStoredCart', () => {
  it('removes the stored cart', () => {
    saveCart({ currency: 'gold', items: [{ ...IRON_SWORD, quantity: 1 }] });
    clearStoredCart();
    expect(loadCart()).toEqual(EMPTY_CART);
  });
});
