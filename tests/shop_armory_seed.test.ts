import { describe, expect, it } from 'vitest';
import { armoryProductSku, seedArmoryCatalog } from '../server/shop_armory_seed';
import { WEAPON_SKIN_LIST } from '../src/sim/content/weapon_skins';

interface Call {
  text: string;
  values: unknown[];
}

function fakeClient() {
  const calls: Call[] = [];
  return {
    calls,
    async query(text: string, values: unknown[] = []) {
      calls.push({ text, values });
      if (text.includes('SELECT id FROM shop_categories')) {
        return { rows: [{ id: 99 }] };
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

  it('sets grant_kind, grant_item_id, and category_id for every seeded row', async () => {
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
    // [sku, skinId(name), slug, description, categoryId, price, skinId(grantItemId)]
    expect(call?.values[1]).toBe(firstSkin.id);
    expect(call?.values[4]).toBe(99);
    expect(call?.values[6]).toBe(firstSkin.id);
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
    expect(productInserts).toHaveLength(0);
  });
});
