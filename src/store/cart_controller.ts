// Thin stateful wrapper around the pure cart core (cart.ts) + its storage
// adapter (cart_storage.ts): holds the live CartState in memory, persists
// every mutation, and notifies subscribers (the header badge, the cart page)
// so they repaint without every page needing its own polling or event wiring.

import {
  type AddItemInput,
  addItem,
  type CartCurrency,
  type CartErrorCode,
  type CartState,
  clearCart,
  removeItem,
  updateQuantity,
} from './cart';
import { clearStoredCart, loadCart, saveCart } from './cart_storage';

export type CartListener = (state: CartState) => void;

export class CartController {
  private state: CartState;
  private listeners = new Set<CartListener>();

  constructor() {
    this.state = loadCart();
  }

  getState(): CartState {
    return this.state;
  }

  subscribe(listener: CartListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private commit(state: CartState): void {
    this.state = state;
    saveCart(state);
    for (const listener of this.listeners) listener(state);
  }

  add(
    item: AddItemInput,
    quantity: number,
    currency: CartCurrency,
  ): { ok: true } | { ok: false; error: CartErrorCode } {
    const result = addItem(this.state, item, quantity, currency);
    if (!result.ok) return result;
    this.commit(result.cart);
    return { ok: true };
  }

  remove(productId: number): void {
    this.commit(removeItem(this.state, productId));
  }

  updateQuantity(productId: number, quantity: number): { ok: true } | { ok: false; error: CartErrorCode } {
    const result = updateQuantity(this.state, productId, quantity);
    if (!result.ok) return result;
    this.commit(result.cart);
    return { ok: true };
  }

  clear(): void {
    clearStoredCart();
    this.commit(clearCart());
  }
}
