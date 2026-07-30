// One-time boot seed: mirrors the Season 1 Armory weapon-skin registry
// (src/sim/content/weapon_skins.ts) into the Shop System (shop_categories +
// shop_products + shop_inventory) as ordinary products under a dedicated
// "Armory" category, each carrying grantKind='weaponSkin' + grantItemId=<skin
// id> (Phase 5, the in-game Shop). This is what lets the in-game Shop sell
// the exact same skins the old WOC Store Armory tab sold, through the one
// general Shop System, with no separate purchase flow to maintain.
//
// Idempotent and additive only, like every other boot seed here (see
// seedChatFilterDefaults, the sibling this mirrors): ON CONFLICT (slug/sku/
// product_id) DO NOTHING, so re-running never overwrites an admin's price/
// name/status edit. Runs inside ensureSchema()'s advisory-lock transaction,
// after SHOP_PRODUCTS_SCHEMA and SHOP_INVENTORY_SCHEMA, so a concurrent
// realm boot cannot race it.
//
// Self-healing backfill (Phase 6): a realm that first seeded this catalog
// BEFORE Phase 6 has armory_* rows with price_gold_copper still NULL (that
// column did not exist in the INSERT yet), which would leave every one of
// them permanently unpurchasable in the gold-priced in-game Shop even after
// the code deploys. Rather than requiring every operator to hand-run a SQL
// backfill, the loop below also runs one scoped, idempotent UPDATE per skin,
// `WHERE sku = $1 AND price_gold_copper IS NULL`: a boot-time self-heal, not
// a resync, so it can only ever fill a price that was never set, exactly the
// same one-way additive contract ON CONFLICT DO NOTHING already gives every
// other column here. An admin who has already priced a row (any non-NULL
// value, including one they deliberately set lower or higher) is untouched.
//
// Every seeded product carries BOTH a Claudium price (the historical tier
// ladder in docs/claudium-store.md, still live for the web storefront and
// any external-economy deployment) and a Gold price (Phase 6: the in-game
// WOC Store's Treasure Chest icon checks out in the player's own gold, no
// external economy service required). Once seeded, both prices are ordinary
// admin-editable Products-page fields like any other product's, not
// re-synced from either source again. Display names are copied ONCE from
// src/ui/i18n.catalog/armory.ts's armorySkinStrings the same way (never
// imported directly: server/ never imports from src/ui/, see server/CLAUDE.md
// "No browser/render/ui imports"), then likewise become ordinary
// admin-editable fields.
//
// Every seeded product also gets an unlimited shop_inventory row: a
// shop_products row with no shop_inventory row at all is "untracked" and
// therefore NEVER orderable (server/CLAUDE.md / SHOP_SYSTEM.md's Phase 3
// business rule), and a cosmetic weapon skin has no real stock limit, the
// same way the old Armory never modeled one.

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

/** Season 1 tier prices, in copper (1 gold = 10000 copper, src/ui/i18n.ts
 *  moneyParts). A starting default scaled against the Claudium ladder above,
 *  same as that ladder itself; admin-editable afterward like any other price. */
const COLLECTION_GOLD_COPPER_PRICE: Record<string, number> = {
  guildmark: 50_000, // 5g
  emberwrought: 250_000, // 25g
  hoarfrost: 750_000, // 75g
  fallen_star: 1_500_000, // 150g
};

/** English display names, copied from src/ui/i18n.catalog/armory.ts's
 *  armorySkinStrings (see the header comment: server/ cannot import src/ui/).
 *  A skin with no entry here falls back to its raw id in seedArmoryCatalog. */
const ARMORY_SKIN_NAMES: Record<string, string> = {
  guildmark_arming_sword: 'Guildmark Arming Sword',
  brasscap_axe: 'Brasscap Hatchet',
  tempered_flanged_mace: 'Tempered Flanged Mace',
  guildmark_dirk: 'Guildmark Dirk',
  brasscrown_staff: 'Brasscrown Walking Staff',
  lacquered_wand: 'Lacquered Rod',
  fletcher_s_guild_bow: "Fletcher's Guild Bow",
  cinderbrand_sword: 'Cinderbrand',
  emberbite_axe: 'Emberbite',
  smoulderfall_mace: 'Smoulderfall',
  ashspark_dagger: 'Ashspark Shiv',
  forgeheart_staff: 'Forgeheart Stave',
  emberwrought_wand: 'Emberwrought Wand',
  cinderlatch_crossbow: 'Cinderlatch',
  ice_fang_sword: 'Ice Fang',
  glaciersplit_axe: 'Glaciersplit',
  rimecrusher_mace: 'Rimecrusher',
  frostbite_dagger: 'Rime Needle',
  hoarfrost_vigil_staff: 'Hoarfrost Vigil',
  everwinter_wand: 'Shard of Everwinter',
  winterbite: 'Winterbite',
  solheim_sword: 'Solheim, Last Light of the Dawn',
  skyrender_axe: "Skyrender, the Firmament's Wound",
  starfall_mace: 'Starfall, Judgment of the Heavens',
  astravyr_dagger: 'Astravyr, Fang of the Fallen Star',
  cosmarch_staff: 'Cosmarch, Spire of the Endless Void',
  emberwish_wand: 'Emberwish, Mote of the Dying Sun',
  encore_bow: 'Encore, the Second Falling Star',
  meteorlatch_crossbow: "Meteorlatch, the Sky's Last Judgment",
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
    const priceClaudium = COLLECTION_CLAUDIUM_PRICE[skin.collection] ?? null;
    if (priceClaudium === null) continue;
    const priceGoldCopper = COLLECTION_GOLD_COPPER_PRICE[skin.collection] ?? null;
    const sku = armoryProductSku(skin.id);
    await client.query(
      `INSERT INTO shop_products
         (sku, name, slug, description, category_id,
          price_claudium, price_gold_copper, status, featured, grant_kind, grant_item_id, grant_quantity)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', false, 'weapon_skin', $8, 1)
       ON CONFLICT (sku) DO NOTHING`,
      [
        sku,
        ARMORY_SKIN_NAMES[skin.id] ?? skin.id,
        `armory-${skin.id.replace(/_/g, '-')}`,
        'Season 1 Armory weapon skin.',
        categoryId,
        priceClaudium,
        priceGoldCopper,
        skin.id,
      ],
    );
    // Self-heal a pre-Phase-6 row (see the header comment): only ever fills a
    // NULL, never overwrites a price an admin already set, so it is safe to
    // run on every boot alongside the insert-or-skip above.
    if (priceGoldCopper !== null) {
      await client.query(
        `UPDATE shop_products SET price_gold_copper = $2, updated_at = now()
         WHERE sku = $1 AND price_gold_copper IS NULL`,
        [sku, priceGoldCopper],
      );
    }
    // The insert above is a no-op on a re-run (ON CONFLICT DO NOTHING), so the
    // product id must always be read back rather than relied on from a
    // RETURNING clause.
    const productRes = await client.query(`SELECT id FROM shop_products WHERE sku = $1`, [sku]);
    const productId = productRes.rows[0]?.id as number | undefined;
    if (productId === undefined) continue;
    await client.query(
      `INSERT INTO shop_inventory
         (product_id, quantity_on_hand, quantity_reserved, low_stock_threshold, unlimited)
       VALUES ($1, 0, 0, 0, true)
       ON CONFLICT (product_id) DO NOTHING`,
      [productId],
    );
  }
}
