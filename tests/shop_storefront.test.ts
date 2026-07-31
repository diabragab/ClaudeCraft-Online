import { describe, expect, it } from 'vitest';
import type { ShopInventoryRecord } from '../server/shop_inventory';
import type { ShopProductRecord } from '../server/shop_products';
import {
  availableCurrencies,
  priceForCurrency,
  productAvailability,
  toStorefrontProduct,
} from '../server/shop_storefront';

function inventory(overrides: Partial<ShopInventoryRecord> = {}): ShopInventoryRecord {
  return {
    id: 1,
    productId: 1,
    productSku: 'sword-01',
    productName: 'Iron Sword',
    quantityOnHand: 10,
    quantityReserved: 0,
    lowStockThreshold: 2,
    unlimited: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function product(overrides: Partial<ShopProductRecord> = {}): ShopProductRecord {
  return {
    id: 1,
    sku: 'sword-01',
    name: 'Iron Sword',
    slug: 'iron-sword',
    description: '',
    categoryId: null,
    priceGoldCopper: 1000,
    priceClaudium: null,
    priceUsdCents: null,
    railSol: false,
    railUsdc: false,
    railWoc: false,
    status: 'active',
    featured: false,
    grantKind: 'none',
    grantItemId: null,
    grantQuantity: 1,
    icon: null,
    displayOrder: 0,
    rarity: 'common',
    badges: [],
    isEvent: false,
    isLimited: false,
    discountPercent: null,
    bannerImage: null,
    previewImage: null,
    announcementTemplate: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('productAvailability', () => {
  it('is unavailable when there is no inventory row', () => {
    expect(productAvailability(null)).toBe('unavailable');
  });

  it('is unlimited for an unlimited row regardless of quantities', () => {
    expect(productAvailability(inventory({ unlimited: true, quantityOnHand: 0 }))).toBe(
      'unlimited',
    );
  });

  it('is out_of_stock when on-hand minus reserved is zero or less', () => {
    expect(productAvailability(inventory({ quantityOnHand: 5, quantityReserved: 5 }))).toBe(
      'out_of_stock',
    );
  });

  it('is low_stock when on-hand is at or under the threshold but some is available', () => {
    expect(
      productAvailability(
        inventory({ quantityOnHand: 2, quantityReserved: 0, lowStockThreshold: 2 }),
      ),
    ).toBe('low_stock');
  });

  it('is in_stock when comfortably above the threshold with availability', () => {
    expect(
      productAvailability(
        inventory({ quantityOnHand: 10, quantityReserved: 1, lowStockThreshold: 2 }),
      ),
    ).toBe('in_stock');
  });
});

describe('priceForCurrency / availableCurrencies', () => {
  it('reads the matching price column per currency', () => {
    const p = product({ priceGoldCopper: 100, priceClaudium: 5, priceUsdCents: 250 });
    expect(priceForCurrency(p, 'gold')).toBe(100);
    expect(priceForCurrency(p, 'claudium')).toBe(5);
    expect(priceForCurrency(p, 'usd')).toBe(250);
  });

  it('returns null for a currency with no price set', () => {
    const p = product({ priceGoldCopper: 100, priceClaudium: null, priceUsdCents: null });
    expect(priceForCurrency(p, 'claudium')).toBeNull();
    expect(priceForCurrency(p, 'usd')).toBeNull();
  });

  it('lists every currency the product has a price for, in gold/claudium/usd order', () => {
    expect(availableCurrencies(product({ priceGoldCopper: 1, priceUsdCents: 1 }))).toEqual([
      'gold',
      'usd',
    ]);
    expect(availableCurrencies(product({ priceGoldCopper: null }))).toEqual([]);
  });
});

describe('toStorefrontProduct', () => {
  it('merges the product record with its computed availability', () => {
    const result = toStorefrontProduct(product(), inventory({ quantityOnHand: 3 }));
    expect(result.id).toBe(1);
    expect(result.availability).toBe('in_stock');
  });
});
