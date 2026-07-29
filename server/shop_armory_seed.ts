// One-time boot seed: mirrors the Season 1 Armory weapon-skin registry
// (src/sim/content/weapon_skins.ts) into the Shop System (shop_categories +
// shop_products) as ordinary products under a dedicated "Armory" category,
// each carrying grantKind='weaponSkin' + grantItemId=<skin id> (Phase 5, the
// in-game Shop). This is what lets the in-game Shop sell the exact same
// skins the old WOC Store Armory tab sold, through the one general Shop
// System, with no separate purchase flow to maintain.
//
// Idempotent and additive only, like every other boot seed here (see
// seedChatFilterDefaults, the sibling this mirrors): ON CONFLICT (slug/sku)
// DO NOTHING, so re-running never overwrites an admin's price/status edit.
// Runs inside ensureSchema()'s advisory-lock transaction, after
// SHOP_PRODUCTS_SCHEMA, so a concurrent realm boot cannot race it.
//
// Seed prices come from the tier ladder already documented in
// docs/claudium-store.md (the same numbers the external economy service's
// Season 1 catalog quoted); once seeded, price_claudium is an ordinary
// admin-editable Products-page field like any other product's, not
// re-synced from that document again.

import { WEAPON_SKIN_LIST } from '../src/sim/content/weapon_skins';

export interface ShopArmorySeedClient {
  query(text: string, values?: unknown[]): Promise<{ rows: any[] }>;
}

export const ARMORY_CATEGORY_SLUG = 'armory';
const ARMORY_CATEGORY_NAME = 'Armory (Weapon Skins)';

/** Season 1 tier prices, in Claudium (docs/claudium-store.md). */
const COLLECTION_CLAUDIUM_PRICE: Record<string, number> = {
  guildmark: 200,
  emberwrought: 1000,
  hoarfrost: 3000,
  fallen_star: 5000,
};

/** The sku a migrated skin product carries; also used to detect "already seeded". */
export function armoryProductSku(skinId: string): string {
  return `armory_${skinId}`;
}

export async function seedArmoryCatalog(client: ShopArmorySeedClient): Promise<void> {
  await client.query(
    `INSERT INTO shop_categories (name, slug, description, parent_id, sort_order, status)
     VALUES ($1, $2, $3, NULL, 0, 'active')
     ON CONFLICT (slug) DO NOTHING`,
    [ARMORY_CATEGORY_NAME, ARMORY_CATEGORY_SLUG, 'Season 1 weapon cosmetics, priced in Claudium.'],
  );
  const categoryRes = await client.query(`SELECT id FROM shop_categories WHERE slug = $1`, [
    ARMORY_CATEGORY_SLUG,
  ]);
  const categoryId = categoryRes.rows[0]?.id as number | undefined;
  if (categoryId === undefined) return;

  for (const skin of WEAPON_SKIN_LIST) {
    const price = COLLECTION_CLAUDIUM_PRICE[skin.collection] ?? null;
    if (price === null) continue;
    await client.query(
      `INSERT INTO shop_products
         (sku, name, slug, description, category_id,
          price_claudium, status, featured, grant_kind, grant_item_id, grant_quantity)
       VALUES ($1, $2, $3, $4, $5, $6, 'active', false, 'weapon_skin', $7, 1)
       ON CONFLICT (sku) DO NOTHING`,
      [
        armoryProductSku(skin.id),
        skin.id,
        `armory-${skin.id.replace(/_/g, '-')}`,
        'Season 1 Armory weapon skin.',
        categoryId,
        price,
        skin.id,
      ],
    );
  }
}
