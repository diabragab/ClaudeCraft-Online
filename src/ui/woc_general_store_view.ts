// Pure projection for the in-game Shop's general product grid (Phase 5): the
// Store tab behind the Treasure Chest icon, replacing the old bespoke Armory
// grid (woc_store_view.ts, still used for nothing now that weapon skins are
// ordinary shop_products rows). DOM/i18n-free and unit-tested: it only
// derives owned/applied/affordable/purchasable per product from the catalog
// snapshot the server already returned (search/category filtering happens
// SERVER-SIDE via the existing /api/shop/products query params, reused
// as-is, not reimplemented here).
//
// Priced and gated on priceGoldCopper (Phase 6): the in-game Shop checks out
// against the player's own live gold (server/shop_gold_checkout.ts), not an
// external economy service. A product with no gold price is never
// purchasable here even if it also carries a Claudium price for the web
// storefront (server/shop_storefront.ts's own currency picker is unaffected).

import { skinnableWeaponTypesFor } from '../sim/content/weapon_skin_rules';
import { WEAPON_SKINS } from '../sim/content/weapon_skins';
import type { WeaponSkinType } from '../sim/types';
import type { AccountCosmetics } from '../world_api/cosmetics';

// Mirrors src/net/shop_client.ts's ShopCatalogProduct/ShopProductGrantKind
// wire shape: ui/ never imports net/ (src/CLAUDE.md's dependency direction),
// so each side declares its own structurally-identical type for the same
// JSON payload, the same split economy_sdk.ts and claudium_proxy.ts already
// use for the Claudium wire shapes. src/main.ts is the only module that
// imports both and passes one where the other is expected.
export type ShopProductGrantKind = 'none' | 'weapon_skin' | 'item';

export interface ShopCatalogProduct {
  id: number;
  sku: string;
  name: string;
  slug: string;
  description: string;
  categoryId: number | null;
  priceGoldCopper: number | null;
  status: 'draft' | 'active' | 'archived';
  featured: boolean;
  grantKind: ShopProductGrantKind;
  grantItemId: string | null;
  grantQuantity: number;
  availability: 'unlimited' | 'in_stock' | 'low_stock' | 'out_of_stock' | 'unavailable';
}

export interface GeneralStoreContext {
  cosmetics: Pick<AccountCosmetics, 'weaponSkinIds' | 'weaponSkinLoadout'>;
  cls: string;
  mainhandItemId: string | null;
}

export interface GeneralStoreCard {
  product: ShopCatalogProduct;
  grantKind: ShopProductGrantKind;
  /** The resolved weapon skin when grantKind is 'weapon_skin' and the id is
   *  still a known skin; null otherwise (a deleted/renamed skin still shows
   *  the raw product name instead of crashing the grid). */
  weaponSkinId: string | null;
  owned: boolean;
  /** Only meaningful when weaponSkinId is set. */
  applied: boolean;
  canApplyNow: boolean;
  purchasable: boolean;
  affordable: boolean;
  shortfall: number | null;
}

/** balanceCopper is the player's own live gold (world.copper, the
 *  IWorldInventory facet member), read directly off IWorld, never fetched
 *  from an external service. */
export function buildGeneralStoreCards(
  products: readonly ShopCatalogProduct[],
  balanceCopper: number | null,
  ctx: GeneralStoreContext,
): GeneralStoreCard[] {
  const applicableTypes = new Set<WeaponSkinType>(
    skinnableWeaponTypesFor(ctx.cls, ctx.mainhandItemId),
  );
  return products.map((product) => {
    const weaponSkinId =
      product.grantKind === 'weapon_skin' &&
      product.grantItemId !== null &&
      Object.hasOwn(WEAPON_SKINS, product.grantItemId)
        ? product.grantItemId
        : null;
    const skin = weaponSkinId ? WEAPON_SKINS[weaponSkinId] : null;
    const owned =
      weaponSkinId !== null ? ctx.cosmetics.weaponSkinIds.includes(weaponSkinId) : false; // non-skin ownership is not tracked client-side (mailed items live in bags/mail)
    const priceGoldCopper = product.priceGoldCopper;
    const purchasable =
      priceGoldCopper !== null &&
      product.status === 'active' &&
      product.availability !== 'out_of_stock' &&
      product.availability !== 'unavailable' &&
      !owned;
    return {
      product,
      grantKind: product.grantKind,
      weaponSkinId,
      owned,
      applied:
        owned && skin !== null && ctx.cosmetics.weaponSkinLoadout[skin.weaponType] === weaponSkinId,
      canApplyNow: owned && skin !== null && applicableTypes.has(skin.weaponType),
      purchasable,
      affordable:
        purchasable &&
        balanceCopper !== null &&
        priceGoldCopper !== null &&
        balanceCopper >= priceGoldCopper,
      shortfall:
        priceGoldCopper === null || balanceCopper === null || owned
          ? null
          : Math.max(0, priceGoldCopper - balanceCopper),
    };
  });
}
