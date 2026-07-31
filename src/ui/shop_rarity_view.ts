// Premium Shop (Phase 2): pure, DOM-free presentation for a shop_products
// row's merchandising rarity and badges, shared by BOTH surfaces that render
// a product card (the in-game Store tab's woc_general_store_view.ts /
// daily_rewards_window.ts, and the standalone storefront's
// src/store/pages/products.ts), so the two can never visually drift. Returns
// CSS class names plus i18n KEYS (never a rendered string): the caller owns
// esc()/t() the same way every other pure-core-plus-thin-painter pair in this
// repo splits that work (src/ui/CLAUDE.md).

import type { TranslationKey } from './i18n.catalog';

export type ShopRarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'mythic';

export type ShopBadge =
  | 'new'
  | 'hot'
  | 'featured'
  | 'best_value'
  | 'limited'
  | 'sale'
  | 'event'
  | 'exclusive'
  | 'popular';

const RARITY_LABEL_KEY: Record<ShopRarity, TranslationKey> = {
  common: 'store.rarity.common',
  uncommon: 'store.rarity.uncommon',
  rare: 'store.rarity.rare',
  epic: 'store.rarity.epic',
  legendary: 'store.rarity.legendary',
  mythic: 'store.rarity.mythic',
};

const BADGE_LABEL_KEY: Record<ShopBadge, TranslationKey> = {
  new: 'store.badge.new',
  hot: 'store.badge.hot',
  featured: 'store.badge.featured',
  best_value: 'store.badge.bestValue',
  limited: 'store.badge.limited',
  sale: 'store.badge.sale',
  event: 'store.badge.event',
  exclusive: 'store.badge.exclusive',
  popular: 'store.badge.popular',
};

/**
 * The card/section CSS modifier for a rarity tier: '' for common (the
 * default look already carries no modifier class, see src/styles/
 * components.css's .armory-card base rule), else 'rarity-<tier>'.
 */
export function shopRarityClass(rarity: ShopRarity): string {
  return rarity === 'common' ? '' : `rarity-${rarity}`;
}

export function shopRarityLabelKey(rarity: ShopRarity): TranslationKey {
  return RARITY_LABEL_KEY[rarity];
}

/** The two classes a badge chip needs: the shared shape and its color modifier. */
export function shopBadgeClass(badge: ShopBadge): string {
  return `shop-badge shop-badge-${badge.replace(/_/g, '-')}`;
}

export function shopBadgeLabelKey(badge: ShopBadge): TranslationKey {
  return BADGE_LABEL_KEY[badge];
}

export interface ShopRarityPresentation {
  /** Append to the card/section's class list; '' for common contributes nothing. */
  cardRarityClass: string;
  rarityLabelKey: TranslationKey;
  /** One entry per badge, in the product's own order; each already carries both CSS classes. */
  badges: readonly { class: string; labelKey: TranslationKey }[];
}

/** The full presentation for one product: its card rarity class plus its badge chips. */
export function shopRarityPresentation(product: {
  rarity: ShopRarity;
  badges: readonly ShopBadge[];
}): ShopRarityPresentation {
  return {
    cardRarityClass: shopRarityClass(product.rarity),
    rarityLabelKey: shopRarityLabelKey(product.rarity),
    badges: product.badges.map((badge) => ({
      class: shopBadgeClass(badge),
      labelKey: shopBadgeLabelKey(badge),
    })),
  };
}
