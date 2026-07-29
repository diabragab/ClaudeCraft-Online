// Storefront (Phase 4) presentation helpers: pure, host-agnostic derivations
// over the EXISTING Phase 1/3 record shapes (ShopProductRecord,
// ShopInventoryRecord). Zero SQL, zero HTTP, zero new business rules: the
// authoritative "is this orderable" check stays exactly where Phase 3 put it
// (ShopOrdersService.createOrder / shop_orders_db.ts, re-validated under
// FOR UPDATE at checkout time). This module only computes what a public
// listing/detail response DISPLAYS, so the storefront never needs its own
// copy of the stock or pricing rules.

import type { ShopInventoryRecord } from './shop_inventory';
import type { ShopOrderCurrency } from './shop_orders';
import type { ShopProductRecord } from './shop_products';

/**
 * A product's display-only stock status. Mirrors the stock states Phase 3's
 * transactional check already enforces, but as a single label a listing/detail
 * page can badge without re-deriving the arithmetic itself.
 */
export type StorefrontAvailability =
  | 'unlimited'
  | 'in_stock'
  | 'low_stock'
  | 'out_of_stock'
  | 'unavailable';

/**
 * Derive display availability from an inventory row (or its absence). `null`
 * (no shop_inventory row) maps to 'unavailable': the same "untracked products
 * are never orderable" rule server/shop_orders_db.ts enforces at checkout.
 */
export function productAvailability(
  inventory: ShopInventoryRecord | null,
): StorefrontAvailability {
  if (!inventory) return 'unavailable';
  if (inventory.unlimited) return 'unlimited';
  const available = inventory.quantityOnHand - inventory.quantityReserved;
  if (available <= 0) return 'out_of_stock';
  if (inventory.quantityOnHand <= inventory.lowStockThreshold) return 'low_stock';
  return 'in_stock';
}

/**
 * The product's price in `currency` (whichever of the three price columns
 * matches), or null when that currency has no price set. A trivial 1:1 field
 * lookup, not a business rule; the actual price/stock VALIDATION a purchase
 * must pass stays solely in ShopOrdersService.createOrder.
 */
export function priceForCurrency(
  product: ShopProductRecord,
  currency: ShopOrderCurrency,
): number | null {
  if (currency === 'gold') return product.priceGoldCopper;
  if (currency === 'claudium') return product.priceClaudium;
  return product.priceUsdCents;
}

/** Every currency `product` carries a price for, in the fixed gold/claudium/usd order. */
export function availableCurrencies(product: ShopProductRecord): ShopOrderCurrency[] {
  const currencies: ShopOrderCurrency[] = [];
  if (product.priceGoldCopper !== null) currencies.push('gold');
  if (product.priceClaudium !== null) currencies.push('claudium');
  if (product.priceUsdCents !== null) currencies.push('usd');
  return currencies;
}

/** The storefront-facing product shape: the catalog record plus its computed availability. */
export interface StorefrontProduct extends ShopProductRecord {
  availability: StorefrontAvailability;
}

export function toStorefrontProduct(
  product: ShopProductRecord,
  inventory: ShopInventoryRecord | null,
): StorefrontProduct {
  return { ...product, availability: productAvailability(inventory) };
}
