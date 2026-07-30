// Thin localStorage persistence for the pure cart core (cart.ts). Kept as a
// separate sibling module (never merged into cart.ts) so the cart's add/
// remove/update rules stay host-agnostic and directly unit-testable, per the
// pure-core-plus-thin-adapter split this repo uses throughout (e.g.
// src/net/resume_play.ts's own header comment on the same localStorage-may-be-
// unavailable caveat).

import { type CartState, EMPTY_CART } from './cart';

const CART_KEY = 'woc_store_cart';

export function loadCart(): CartState {
  try {
    const raw = localStorage.getItem(CART_KEY);
    if (!raw) return EMPTY_CART;
    const data = JSON.parse(raw) as Partial<CartState>;
    if (!Array.isArray(data.items)) return EMPTY_CART;
    const currency = data.currency === 'gold' || data.currency === 'claudium' || data.currency === 'usd'
      ? data.currency
      : null;
    const items = data.items.filter(
      (i): i is CartState['items'][number] =>
        !!i &&
        typeof i.productId === 'number' &&
        typeof i.slug === 'string' &&
        typeof i.name === 'string' &&
        typeof i.unitPrice === 'number' &&
        Number.isInteger(i.quantity) &&
        i.quantity > 0,
    );
    return { currency: items.length > 0 ? currency : null, items };
  } catch {
    return EMPTY_CART;
  }
}

export function saveCart(cart: CartState): void {
  try {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
  } catch {
    /* storage may be unavailable (private mode); the cart stays in-memory only */
  }
}

export function clearStoredCart(): void {
  try {
    localStorage.removeItem(CART_KEY);
  } catch {
    /* ignore */
  }
}
