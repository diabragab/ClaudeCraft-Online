// Premium Shop (Phase 2C): pure, DOM-free presentation for the purchase
// success/failure popup that replaces daily_rewards_window.ts's old silent
// inline repaint (a successful buy re-rendered the store with no feedback; a
// failed one reused the CATALOG-LOAD error banner and blanked the whole grid).
// One view model for both outcomes so the window painter has a single
// render() call; the caller owns esc()/t() (src/ui/CLAUDE.md's pure-core
// split).

import type { TranslationKey } from './i18n.catalog';
import {
  type ShopBadge,
  type ShopRarity,
  type ShopRarityPresentation,
  shopRarityPresentation,
} from './shop_rarity_view';

export interface ShopPurchaseResultProduct {
  name: string;
  rarity: ShopRarity;
  badges: readonly ShopBadge[];
  art: string | null;
}

export type ShopPurchaseResultInput =
  | { kind: 'success'; product: ShopPurchaseResultProduct }
  | { kind: 'failure'; product: ShopPurchaseResultProduct };

// Epic and above get the celebratory glow-pulse treatment (components.css'
// shop-result-celebratory rule); common/uncommon/rare still confirm clearly,
// just without the extra flourish, so the animation reads as "this one was
// special" rather than decoration applied uniformly.
const CELEBRATORY_RARITIES: ReadonlySet<ShopRarity> = new Set(['epic', 'legendary', 'mythic']);

export interface ShopPurchaseResultView {
  kind: 'success' | 'failure';
  titleKey: TranslationKey;
  bodyKey: TranslationKey;
  productName: string;
  art: string | null;
  presentation: ShopRarityPresentation;
  celebratory: boolean;
}

export function buildShopPurchaseResultView(
  input: ShopPurchaseResultInput,
): ShopPurchaseResultView {
  const presentation = shopRarityPresentation(input.product);
  return {
    kind: input.kind,
    titleKey:
      input.kind === 'success'
        ? 'hudChrome.wocStore.purchaseResult.successTitle'
        : 'hudChrome.wocStore.purchaseResult.failureTitle',
    bodyKey:
      input.kind === 'success'
        ? 'hudChrome.wocStore.purchaseResult.successBody'
        : 'hudChrome.wocStore.purchaseResult.failureBody',
    productName: input.product.name,
    art: input.product.art,
    presentation,
    celebratory: input.kind === 'success' && CELEBRATORY_RARITIES.has(input.product.rarity),
  };
}
