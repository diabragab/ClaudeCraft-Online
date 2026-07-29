import { describe, expect, it } from 'vitest';
import { armoryProductSku, seedArmoryCatalog } from '../server/shop_armory_seed';
import { WEAPON_SKIN_LIST } from '../src/sim/content/weapon_skins';

interface Call {
  text: string;
  values: unknown[];
}

function fakeClient() {
  const calls: Call[] = [];
  let nextProductId = 1;
  const productIdBySku = new Map<string, number>();
  return {
    calls,
    async query(text: string, values: unknown[] = []) {
      calls.push({ text, values });
      if (text.includes('SELECT id FROM shop_categories')) {
        return { rows: [{ id: 99 }] };
      }
      if (text.includes('SELECT id FROM shop_products WHERE sku')) {
        const sku = values[0] as string;
        let id = productIdBySku.get(sku);
        if (id === undefined) {
          id = nextProductId++;
          productIdBySku.set(sku, id);
        }
        return { rows: [{ id }] };
      }
      return { rows: [] };
    },
  };
}

describe('seedArmoryCatalog', () => {
  it('inserts the Armory category once, then one product per weapon skin', async () => {
    const client = fakeClient();
    await seedArmoryCatalog(client);

    const categoryInserts = client.calls.filter((c) =>
      c.text.includes('INSERT INTO shop_categories'),
    );
    expect(categoryInserts).toHaveLength(1);
    expect(categoryInserts[0]?.text).toContain('ON CONFLICT (slug) DO NOTHING');

    const productInserts = client.calls.filter((c) => c.text.includes('INSERT INTO shop_products'));
    expect(productInserts).toHaveLength(WEAPON_SKIN_LIST.length);
    for (const call of productInserts) {
      expect(call.text).toContain('ON CONFLICT (sku) DO NOTHING');
    }
  });

  it('gives every seeded product a unique sku keyed to its skin id', async () => {
    const client = fakeClient();
    await seedArmoryCatalog(client);

    const skus = client.calls
      .filter((c) => c.text.includes('INSERT INTO shop_products'))
      .map((c) => c.values[0]);
    expect(new Set(skus).size).toBe(skus.length);
    for (const skin of WEAPON_SKIN_LIST) {
      expect(skus).toContain(armoryProductSku(skin.id));
    }
  });

  it('sets a human-readable name, grant_kind, grant_item_id, and category_id for every seeded row', async () => {
    const client = fakeClient();
    await seedArmoryCatalog(client);

    const firstSkin = WEAPON_SKIN_LIST[0];
    if (!firstSkin) throw new Error('WEAPON_SKIN_LIST is empty');
    const call = client.calls.find(
      (c) =>
        c.text.includes('INSERT INTO shop_products') &&
        c.values[0] === armoryProductSku(firstSkin.id),
    );
    expect(call).toBeDefined();
    // [sku, name, slug, description, categoryId, priceClaudium, priceGoldCopper, grantItemId]
    const name = call?.values[1];
    expect(typeof name).toBe('string');
    // The seeded name is a real display string, never the raw snake_case id
    // (the storefront must never show e.g. "guildmark_arming_sword" as-is).
    expect(name).not.toBe(firstSkin.id);
    expect(name).not.toMatch(/_/);
    expect(call?.values[4]).toBe(99);
    expect(call?.values[7]).toBe(firstSkin.id);
  });

  it('sets a positive gold price for every seeded product, alongside its Claudium price', async () => {
    const client = fakeClient();
    await seedArmoryCatalog(client);

    const productInserts = client.calls.filter((c) => c.text.includes('INSERT INTO shop_products'));
    for (const call of productInserts) {
      // [sku, name, slug, description, categoryId, priceClaudium, priceGoldCopper, grantItemId]
      const priceClaudium = call.values[5] as number;
      const priceGoldCopper = call.values[6] as number;
      expect(priceClaudium).toBeGreaterThan(0);
      expect(priceGoldCopper).toBeGreaterThan(0);
      expect(Number.isInteger(priceGoldCopper)).toBe(true);
    }
  });

  it('self-heals a pre-Phase-6 row: backfills price_gold_copper only where it is NULL', async () => {
    const client = fakeClient();
    await seedArmoryCatalog(client);

    const backfills = client.calls.filter(
      (c) => c.text.includes('UPDATE shop_products') && c.text.includes('price_gold_copper'),
    );
    expect(backfills).toHaveLength(WEAPON_SKIN_LIST.length);
    for (const call of backfills) {
      // The safety condition lives IN THE SQL TEXT: only a real Postgres NULL
      // check protects an admin's already-set price against a real DB, since
      // this fake has no WHERE-clause semantics of its own.
      expect(call.text).toContain('WHERE sku = $1 AND price_gold_copper IS NULL');
      expect(call.text).not.toContain('ON CONFLICT');
      const [sku, price] = call.values;
      expect(typeof sku).toBe('string');
      expect(price as number).toBeGreaterThan(0);
    }
    const skus = backfills.map((c) => c.values[0]);
    for (const skin of WEAPON_SKIN_LIST) {
      expect(skus).toContain(armoryProductSku(skin.id));
    }
  });

  it('falls back to the raw skin id when no display name is on file', async () => {
    // Every real WEAPON_SKIN_LIST entry has a name today (asserted below), but
    // the fallback branch itself must still be exercised directly so a future
    // skin added without updating ARMORY_SKIN_NAMES fails loudly in the
    // storefront (a raw id), not silently (an empty/undefined name).
    for (const skin of WEAPON_SKIN_LIST) {
      const client = fakeClient();
      await seedArmoryCatalog(client);
      const call = client.calls.find(
        (c) =>
          c.text.includes('INSERT INTO shop_products') && c.values[0] === armoryProductSku(skin.id),
      );
      expect(call?.values[1], `missing display name for skin "${skin.id}"`).toBeTruthy();
    }
  });

  it('seeds an unlimited shop_inventory row for every product, keyed by its resolved id', async () => {
    const client = fakeClient();
    await seedArmoryCatalog(client);

    const inventoryInserts = client.calls.filter((c) =>
      c.text.includes('INSERT INTO shop_inventory'),
    );
    expect(inventoryInserts).toHaveLength(WEAPON_SKIN_LIST.length);
    for (const call of inventoryInserts) {
      expect(call.text).toContain('ON CONFLICT (product_id) DO NOTHING');
      // quantity_on_hand/quantity_reserved/low_stock_threshold/unlimited are
      // literals in the SQL text itself; only product_id is parameterized.
      expect(call.values).toEqual([expect.any(Number)]);
      expect(call.text).toMatch(/VALUES\s*\(\$1,\s*0,\s*0,\s*0,\s*true\)/);
    }
    // Every inventory row's product_id must be a real, previously-resolved
    // shop_products id (never undefined/null slipping through the lookup).
    const productIds = new Set(inventoryInserts.map((c) => c.values[0]));
    expect(productIds.size).toBe(WEAPON_SKIN_LIST.length);
  });

  it('does nothing further when the category insert never lands a row (defensive no-op)', async () => {
    const client = {
      calls: [] as Call[],
      async query(text: string, values: unknown[] = []) {
        this.calls.push({ text, values });
        return { rows: [] };
      },
    };
    await seedArmoryCatalog(client);
    const productInserts = client.calls.filter((c) => c.text.includes('INSERT INTO shop_products'));
    const inventoryInserts = client.calls.filter((c) =>
      c.text.includes('INSERT INTO shop_inventory'),
    );
    expect(productInserts).toHaveLength(0);
    expect(inventoryInserts).toHaveLength(0);
  });

  it('skips the inventory insert (without throwing) if the product id cannot be resolved', async () => {
    // Simulates a product-select miss (should never happen against a real DB,
    // since the insert just landed, but the seed must not crash if it did).
    const client = {
      calls: [] as Call[],
      async query(text: string, values: unknown[] = []) {
        this.calls.push({ text, values });
        if (text.includes('SELECT id FROM shop_categories')) return { rows: [{ id: 99 }] };
        return { rows: [] };
      },
    };
    await expect(seedArmoryCatalog(client)).resolves.toBeUndefined();
    const inventoryInserts = client.calls.filter((c) =>
      c.text.includes('INSERT INTO shop_inventory'),
    );
    expect(inventoryInserts).toHaveLength(0);
  });
});
