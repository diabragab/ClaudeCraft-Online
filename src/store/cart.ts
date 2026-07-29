// Pure shopping-cart core: no DOM, no fetch, no localStorage (see cart_storage.ts
// for the thin persistence adapter). A cart is scoped to ONE currency, mirroring
// the order model server/shop_orders.ts already enforces (an order is created in
// exactly one of gold/claudium/usd): adding a product locks the cart to that
// product's chosen currency, and adding a product with no price in the cart's
// current currency is rejected rather than silently mixing currencies an order
// could never actually check out in.
//
// Each line item carries a DISPLAY snapshot (slug/name/unitPrice) taken at
// add-to-cart time, the same snapshot-at-write-time idea server/shop_orders_db.ts
// already uses for shop_order_items, so the cart and checkout-review pages can
// render without a second product lookup. The snapshot is cosmetic only: it
// never gates or prices the actual purchase. The authoritative price/stock
// check is the exact same server/shop_orders.ts transaction Phase 3 built,
// re-run unconditionally at checkout (POST /api/shop/orders) against the
// LIVE product row, never against anything the client sends.

export type CartCurrency = 'gold' | 'claudium' | 'usd';

export interface CartItem {
  productId: number;
  slug: string;
  name: string;
  /** Snapshotted at add-to-cart time, in `CartState.currency`'s smallest unit. Display only. */
  unitPrice: number;
  quantity: number;
}

export interface CartState {
  currency: CartCurrency | null;
  items: CartItem[];
}

export const EMPTY_CART: CartState = { currency: null, items: [] };

export type CartErrorCode = 'currency_mismatch' | 'invalid_quantity';

export type CartResult = { ok: true; cart: CartState } | { ok: false; error: CartErrorCode };

const MAX_QUANTITY = 9999;

function clampQuantity(quantity: number): number | null {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) return null;
  return quantity;
}

export interface AddItemInput {
  productId: number;
  slug: string;
  name: string;
  unitPrice: number;
}

/**
 * Add `quantity` of `item` (priced in `currency`) to the cart. An empty cart
 * adopts `currency`; a non-empty cart in a DIFFERENT currency rejects the add
 * with 'currency_mismatch' rather than silently switching or mixing. Adding a
 * product already in the cart sums the quantities (capped at MAX_QUANTITY,
 * snapshot fields refreshed to the latest add) and refreshes its display
 * snapshot, mirroring how the checkout order itself merges duplicate
 * productIds (server/shop_orders.ts's ShopOrdersService.createOrder).
 */
export function addItem(
  cart: CartState,
  item: AddItemInput,
  quantity: number,
  currency: CartCurrency,
): CartResult {
  const qty = clampQuantity(quantity);
  if (qty === null) return { ok: false, error: 'invalid_quantity' };
  if (cart.currency !== null && cart.currency !== currency) {
    return { ok: false, error: 'currency_mismatch' };
  }
  const existing = cart.items.find((i) => i.productId === item.productId);
  const items = existing
    ? cart.items.map((i) =>
        i.productId === item.productId
          ? { ...item, quantity: Math.min(MAX_QUANTITY, i.quantity + qty) }
          : i,
      )
    : [...cart.items, { ...item, quantity: qty }];
  return { ok: true, cart: { currency, items } };
}

/** Remove a line item entirely, regardless of its quantity. */
export function removeItem(cart: CartState, productId: number): CartState {
  const items = cart.items.filter((i) => i.productId !== productId);
  return { currency: items.length > 0 ? cart.currency : null, items };
}

/**
 * Set a line item's quantity directly (from a quantity-stepper input). A
 * quantity of 0 or below removes the item, matching a stepper decremented to
 * zero being the natural "remove" gesture; an out-of-range positive quantity
 * is rejected rather than silently clamped, so the UI can show why the input
 * did not take.
 */
export function updateQuantity(cart: CartState, productId: number, quantity: number): CartResult {
  if (quantity <= 0) return { ok: true, cart: removeItem(cart, productId) };
  const qty = clampQuantity(quantity);
  if (qty === null) return { ok: false, error: 'invalid_quantity' };
  const items = cart.items.map((i) => (i.productId === productId ? { ...i, quantity: qty } : i));
  return { ok: true, cart: { ...cart, items } };
}

export function clearCart(): CartState {
  return EMPTY_CART;
}

/** Total item count across every line (for a header cart badge). */
export function cartItemCount(cart: CartState): number {
  return cart.items.reduce((sum, i) => sum + i.quantity, 0);
}

/** Sum of unitPrice * quantity across every line (display-only subtotal). */
export function cartSubtotal(cart: CartState): number {
  return cart.items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0);
}

export function isCartEmpty(cart: CartState): boolean {
  return cart.items.length === 0;
}
