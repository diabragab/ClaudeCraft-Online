import { describe, expect, it } from 'vitest';
import {
  shopBadgeClass,
  shopBadgeLabelKey,
  shopRarityClass,
  shopRarityLabelKey,
  shopRarityPresentation,
} from '../src/ui/shop_rarity_view';

describe('shopRarityClass', () => {
  it('contributes no class for common (the default look)', () => {
    expect(shopRarityClass('common')).toBe('');
  });

  it('returns rarity-<tier> for every other tier', () => {
    expect(shopRarityClass('uncommon')).toBe('rarity-uncommon');
    expect(shopRarityClass('rare')).toBe('rarity-rare');
    expect(shopRarityClass('epic')).toBe('rarity-epic');
    expect(shopRarityClass('legendary')).toBe('rarity-legendary');
    expect(shopRarityClass('mythic')).toBe('rarity-mythic');
  });
});

describe('shopRarityLabelKey', () => {
  it('returns a distinct i18n key per tier', () => {
    const keys = new Set(
      (['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'] as const).map(
        shopRarityLabelKey,
      ),
    );
    expect(keys.size).toBe(6);
  });
});

describe('shopBadgeClass', () => {
  it('carries both the shared shape class and the color modifier', () => {
    expect(shopBadgeClass('hot')).toBe('shop-badge shop-badge-hot');
  });

  it('converts a snake_case badge value to a kebab-case CSS modifier', () => {
    expect(shopBadgeClass('best_value')).toBe('shop-badge shop-badge-best-value');
  });
});

describe('shopBadgeLabelKey', () => {
  it('returns a distinct i18n key per badge', () => {
    const badges = [
      'new',
      'hot',
      'featured',
      'best_value',
      'limited',
      'sale',
      'event',
      'exclusive',
      'popular',
    ] as const;
    const keys = new Set(badges.map(shopBadgeLabelKey));
    expect(keys.size).toBe(9);
  });
});

describe('shopRarityPresentation', () => {
  it('builds the full presentation for a plain common product with no badges', () => {
    const presentation = shopRarityPresentation({ rarity: 'common', badges: [] });
    expect(presentation.cardRarityClass).toBe('');
    expect(presentation.rarityLabelKey).toBe(shopRarityLabelKey('common'));
    expect(presentation.badges).toEqual([]);
  });

  it('builds the full presentation for a mythic product with multiple badges, in order', () => {
    const presentation = shopRarityPresentation({
      rarity: 'mythic',
      badges: ['event', 'exclusive'],
    });
    expect(presentation.cardRarityClass).toBe('rarity-mythic');
    expect(presentation.badges).toEqual([
      { class: shopBadgeClass('event'), labelKey: shopBadgeLabelKey('event') },
      { class: shopBadgeClass('exclusive'), labelKey: shopBadgeLabelKey('exclusive') },
    ]);
  });
});
