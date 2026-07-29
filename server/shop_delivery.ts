// In-game Shop delivery (Phase 5/6): the one function that turns an
// already-paid shop_products grant into a real drop into the buyer's
// account/mailbox. Shared by every checkout currency (Claudium, Gold, ...)
// so a new payment rail never means a second delivery implementation.
// No pricing, stock, or currency logic lives here: the caller has already
// charged the buyer and marked the order paid before calling deliverShopProduct.

import { grantWeaponSkinForShop } from './claudium';
import type { ShopProductRecord } from './shop_products';

/**
 * Live-game hook, injected from server/main.ts (configureShopDeliveryRuntime).
 * Weapon-skin delivery needs no hook of its own: it reuses grantWeaponSkinForShop
 * (server/claudium.ts), which is already live-game-wired via configureClaudiumRuntime.
 */
export interface ShopDeliveryRuntimeHooks {
  /** Returns false when the character has no live session on this realm. */
  mailItemToCharacter(characterId: number, itemId: string, count: number): boolean;
}
let deliveryRuntime: ShopDeliveryRuntimeHooks | null = null;

export function configureShopDeliveryRuntime(rt: ShopDeliveryRuntimeHooks): void {
  deliveryRuntime = rt;
}

/**
 * Best-effort: the currency charge already succeeded and the order is already
 * 'paid' by the time this runs, so a delivery hiccup never re-charges the
 * player; it only means an admin may need to re-send the grant by hand, the
 * same recovery story grantWeaponSkinsToAccount already relies on for its
 * own persistence write.
 */
export function deliverShopProduct(
  product: ShopProductRecord,
  characterId: number,
  accountId: number,
  quantity: number,
): void {
  if (product.grantKind === 'weapon_skin' && product.grantItemId) {
    grantWeaponSkinForShop(accountId, product.grantItemId);
    return;
  }
  if (product.grantKind === 'item' && product.grantItemId) {
    const count = product.grantQuantity * quantity;
    deliveryRuntime?.mailItemToCharacter(characterId, product.grantItemId, count);
  }
}
