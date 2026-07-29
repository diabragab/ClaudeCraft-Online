import { describe, expect, it } from 'vitest';
import {
  addItem,
  type AddItemInput,
  cartItemCount,
  cartSubtotal,
  clearCart,
  EMPTY_CART,
  isCartEmpty,
  removeItem,
  updateQuantity,
} from '../../src/store/cart';

function sword(overrides: Partial<AddItemInput> = {}): AddItemInput {
  return { productId: 1, slug: 'iron-sword', name: 'Iron Sword', unitPrice: 100, ...overrides };
}

function shield(overrides: Partial<AddItemInput> = {}): AddItemInput {
  return { productId: 2, slug: 'wooden-shield', name: 'Wooden Shield', unitPrice: 50, ...overrides };
}

describe('addItem', () => {
  it('adds a new line item and adopts its currency on an empty cart', () => {
    const result = addItem(EMPTY_CART, sword(), 2, 'gold');
    expect(result).toEqual({
      ok: true,
      cart: { currency: 'gold', items: [{ ...sword(), quantity: 2 }] },
    });
  });

  it('sums quantity when the same product is added again', () => {
    const first = addItem(EMPTY_CART, sword(), 2, 'gold');
    if (!first.ok) throw new Error('setup failed');
    const second = addItem(first.cart, sword(), 3, 'gold');
    expect(second).toEqual({
      ok: true,
      cart: { currency: 'gold', items: [{ ...sword(), quantity: 5 }] },
    });
  });

  it('refreshes the display snapshot when the same product is added again', () => {
    const first = addItem(EMPTY_CART, sword(), 1, 'gold');
    if (!first.ok) throw new Error('setup failed');
    const second = addItem(first.cart, sword({ unitPrice: 150 }), 1, 'gold');
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.cart.items[0].unitPrice).toBe(150);
  });

  it('adds a second distinct product in the same currency', () => {
    const first = addItem(EMPTY_CART, sword(), 1, 'gold');
    if (!first.ok) throw new Error('setup failed');
    const second = addItem(first.cart, shield(), 4, 'gold');
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.cart.items).toEqual([
        { ...sword(), quantity: 1 },
        { ...shield(), quantity: 4 },
      ]);
    }
  });

  it('rejects a currency that does not match the cart already in progress', () => {
    const first = addItem(EMPTY_CART, sword(), 1, 'gold');
    if (!first.ok) throw new Error('setup failed');
    const second = addItem(first.cart, shield(), 1, 'usd');
    expect(second).toEqual({ ok: false, error: 'currency_mismatch' });
  });

  it('rejects a non-positive or out-of-range quantity', () => {
    expect(addItem(EMPTY_CART, sword(), 0, 'gold')).toEqual({ ok: false, error: 'invalid_quantity' });
    expect(addItem(EMPTY_CART, sword(), -1, 'gold')).toEqual({ ok: false, error: 'invalid_quantity' });
    expect(addItem(EMPTY_CART, sword(), 10000, 'gold')).toEqual({ ok: false, error: 'invalid_quantity' });
  });

  it('caps a summed quantity at the maximum rather than overflowing', () => {
    const first = addItem(EMPTY_CART, sword(), 9999, 'gold');
    if (!first.ok) throw new Error('setup failed');
    const second = addItem(first.cart, sword(), 1, 'gold');
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.cart.items[0].quantity).toBe(9999);
  });
});

describe('removeItem', () => {
  it('removes the matching line item', () => {
    const cart = {
      currency: 'gold' as const,
      items: [{ ...sword(), quantity: 2 }, { ...shield(), quantity: 1 }],
    };
    const result = removeItem(cart, 1);
    expect(result.items).toEqual([{ ...shield(), quantity: 1 }]);
    expect(result.currency).toBe('gold');
  });

  it('clears the currency once the cart becomes empty', () => {
    const cart = { currency: 'gold' as const, items: [{ ...sword(), quantity: 2 }] };
    const result = removeItem(cart, 1);
    expect(result).toEqual(EMPTY_CART);
  });
});

describe('updateQuantity', () => {
  it('sets a line item to a new positive quantity', () => {
    const cart = { currency: 'gold' as const, items: [{ ...sword(), quantity: 2 }] };
    const result = updateQuantity(cart, 1, 7);
    expect(result).toEqual({
      ok: true,
      cart: { currency: 'gold', items: [{ ...sword(), quantity: 7 }] },
    });
  });

  it('removes the item when set to zero or below', () => {
    const cart = { currency: 'gold' as const, items: [{ ...sword(), quantity: 2 }] };
    const result = updateQuantity(cart, 1, 0);
    expect(result).toEqual({ ok: true, cart: EMPTY_CART });
  });

  it('rejects an out-of-range quantity', () => {
    const cart = { currency: 'gold' as const, items: [{ ...sword(), quantity: 2 }] };
    expect(updateQuantity(cart, 1, 10000)).toEqual({ ok: false, error: 'invalid_quantity' });
  });
});

describe('clearCart / cartItemCount / cartSubtotal / isCartEmpty', () => {
  it('clearCart returns the empty cart', () => {
    expect(clearCart()).toBe(EMPTY_CART);
  });

  it('cartItemCount sums quantities across every line', () => {
    const cart = {
      currency: 'gold' as const,
      items: [{ ...sword(), quantity: 2 }, { ...shield(), quantity: 3 }],
    };
    expect(cartItemCount(cart)).toBe(5);
    expect(cartItemCount(EMPTY_CART)).toBe(0);
  });

  it('cartSubtotal sums unitPrice * quantity across every line', () => {
    const cart = {
      currency: 'gold' as const,
      items: [{ ...sword(), quantity: 2 }, { ...shield(), quantity: 3 }],
    };
    // 100*2 + 50*3 = 350
    expect(cartSubtotal(cart)).toBe(350);
    expect(cartSubtotal(EMPTY_CART)).toBe(0);
  });

  it('isCartEmpty reflects whether any line items remain', () => {
    expect(isCartEmpty(EMPTY_CART)).toBe(true);
    expect(isCartEmpty({ currency: 'gold', items: [{ ...sword(), quantity: 1 }] })).toBe(false);
  });
});
