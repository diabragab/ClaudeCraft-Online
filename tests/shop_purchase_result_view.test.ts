import { describe, expect, it } from 'vitest';
import { buildShopPurchaseResultView } from '../src/ui/shop_purchase_result_view';

const PRODUCT = { name: 'Iron Sword', rarity: 'common' as const, badges: [], art: '/x.webp' };

describe('buildShopPurchaseResultView', () => {
  it('builds a success view with the success title/body keys', () => {
    const view = buildShopPurchaseResultView({ kind: 'success', product: PRODUCT });
    expect(view.kind).toBe('success');
    expect(view.titleKey).toBe('hudChrome.wocStore.purchaseResult.successTitle');
    expect(view.bodyKey).toBe('hudChrome.wocStore.purchaseResult.successBody');
    expect(view.productName).toBe('Iron Sword');
    expect(view.art).toBe('/x.webp');
  });

  it('builds a failure view with the failure title/body keys and no celebration', () => {
    const view = buildShopPurchaseResultView({ kind: 'failure', product: PRODUCT });
    expect(view.kind).toBe('failure');
    expect(view.titleKey).toBe('hudChrome.wocStore.purchaseResult.failureTitle');
    expect(view.bodyKey).toBe('hudChrome.wocStore.purchaseResult.failureBody');
    expect(view.celebratory).toBe(false);
  });

  it('marks epic, legendary, and mythic successes as celebratory', () => {
    for (const rarity of ['epic', 'legendary', 'mythic'] as const) {
      const view = buildShopPurchaseResultView({
        kind: 'success',
        product: { ...PRODUCT, rarity },
      });
      expect(view.celebratory).toBe(true);
    }
  });

  it('does not celebrate common, uncommon, or rare successes', () => {
    for (const rarity of ['common', 'uncommon', 'rare'] as const) {
      const view = buildShopPurchaseResultView({
        kind: 'success',
        product: { ...PRODUCT, rarity },
      });
      expect(view.celebratory).toBe(false);
    }
  });

  it('never celebrates a failure, even at mythic rarity', () => {
    const view = buildShopPurchaseResultView({
      kind: 'failure',
      product: { ...PRODUCT, rarity: 'mythic' },
    });
    expect(view.celebratory).toBe(false);
  });

  it('carries the shared rarity presentation through, including badge chips', () => {
    const view = buildShopPurchaseResultView({
      kind: 'success',
      product: { ...PRODUCT, rarity: 'legendary', badges: ['hot', 'limited'] },
    });
    expect(view.presentation.cardRarityClass).toBe('rarity-legendary');
    expect(view.presentation.badges).toEqual([
      { class: 'shop-badge shop-badge-hot', labelKey: 'store.badge.hot' },
      { class: 'shop-badge shop-badge-limited', labelKey: 'store.badge.limited' },
    ]);
  });

  it('passes through a null art with no product image', () => {
    const view = buildShopPurchaseResultView({
      kind: 'success',
      product: { ...PRODUCT, art: null },
    });
    expect(view.art).toBeNull();
  });
});
