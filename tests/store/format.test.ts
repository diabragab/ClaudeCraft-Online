import { describe, expect, it } from 'vitest';
import { availabilityLabel, formatPrice, isPurchasable } from '../../src/store/format';

describe('formatPrice', () => {
  it('formats gold via the shared copper formatter', () => {
    // 1 gold, 0 silver, 0 copper (10000 copper = 1 gold).
    expect(formatPrice(10000, 'gold')).toContain('1');
  });

  it('formats claudium with the Claudium brand suffix', () => {
    expect(formatPrice(5, 'claudium')).toBe('5 Claudium');
  });

  it('formats usd as dollars and cents', () => {
    expect(formatPrice(1999, 'usd')).toBe('$19.99');
    expect(formatPrice(100, 'usd')).toBe('$1.00');
  });
});

describe('availabilityLabel', () => {
  it('returns a non-empty label for every availability state', () => {
    for (const availability of ['unlimited', 'in_stock', 'low_stock', 'out_of_stock', 'unavailable'] as const) {
      expect(availabilityLabel(availability).length).toBeGreaterThan(0);
    }
  });
});

describe('isPurchasable', () => {
  it('is purchasable for unlimited/in_stock/low_stock', () => {
    expect(isPurchasable('unlimited')).toBe(true);
    expect(isPurchasable('in_stock')).toBe(true);
    expect(isPurchasable('low_stock')).toBe(true);
  });

  it('is not purchasable for out_of_stock/unavailable', () => {
    expect(isPurchasable('out_of_stock')).toBe(false);
    expect(isPurchasable('unavailable')).toBe(false);
  });
});
