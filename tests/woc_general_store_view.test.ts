import { describe, expect, it } from 'vitest';
import { buildGeneralStoreCards, type ShopCatalogProduct } from '../src/ui/woc_general_store_view';

function product(overrides: Partial<ShopCatalogProduct> = {}): ShopCatalogProduct {
  return {
    id: 1,
    sku: 'armory_cinderbrand_sword',
    name: 'Cinderbrand Sword',
    slug: 'armory-cinderbrand-sword',
    description: '',
    categoryId: null,
    priceClaudium: 200,
    icon: null,
    displayOrder: 0,
    status: 'active',
    featured: false,
    grantKind: 'weapon_skin',
    grantItemId: 'cinderbrand_sword',
    grantQuantity: 1,
    availability: 'unlimited',
    ...overrides,
  };
}

const CTX = {
  cosmetics: { weaponSkinIds: [], weaponSkinLoadout: {} },
  cls: 'warrior',
  mainhandItemId: null,
};

describe('buildGeneralStoreCards', () => {
  it('resolves a known weapon-skin grant to its skin id', () => {
    const [card] = buildGeneralStoreCards([product()], 1_000, CTX);
    expect(card.weaponSkinId).toBe('cinderbrand_sword');
    expect(card.grantKind).toBe('weapon_skin');
  });

  it('falls back to null for an unknown or renamed skin id', () => {
    const [card] = buildGeneralStoreCards(
      [product({ grantItemId: 'no_longer_exists' })],
      1_000,
      CTX,
    );
    expect(card.weaponSkinId).toBeNull();
  });

  it('treats a non-weapon-skin item grant as never owned client-side', () => {
    const [card] = buildGeneralStoreCards(
      [product({ grantKind: 'item', grantItemId: 'healing_potion' })],
      1_000,
      CTX,
    );
    expect(card.owned).toBe(false);
    expect(card.weaponSkinId).toBeNull();
  });

  it('marks a product owned and applied from account cosmetics', () => {
    const [card] = buildGeneralStoreCards([product()], 1_000, {
      ...CTX,
      cosmetics: {
        weaponSkinIds: ['cinderbrand_sword'],
        weaponSkinLoadout: { sword: 'cinderbrand_sword' },
      },
    });
    expect(card.owned).toBe(true);
    expect(card.applied).toBe(true);
    expect(card.purchasable).toBe(false);
  });

  it('computes affordability and shortfall against the given balance', () => {
    const [affordable] = buildGeneralStoreCards([product({ priceClaudium: 200 })], 500, CTX);
    expect(affordable.affordable).toBe(true);
    expect(affordable.shortfall).toBe(0);

    const [tooExpensive] = buildGeneralStoreCards([product({ priceClaudium: 900 })], 500, CTX);
    expect(tooExpensive.affordable).toBe(false);
    expect(tooExpensive.shortfall).toBe(400);
  });

  it('is never purchasable with no Claudium price, inactive status, or out-of-stock availability', () => {
    const cases = [
      product({ priceClaudium: null }),
      product({ status: 'draft' }),
      product({ availability: 'out_of_stock' }),
      product({ availability: 'unavailable' }),
    ];
    for (const p of cases) {
      const [card] = buildGeneralStoreCards([p], 1_000, CTX);
      expect(card.purchasable).toBe(false);
    }
  });

  it('never marks an already-owned product purchasable even if otherwise eligible', () => {
    const [card] = buildGeneralStoreCards([product()], 1_000, {
      ...CTX,
      cosmetics: { weaponSkinIds: ['cinderbrand_sword'], weaponSkinLoadout: {} },
    });
    expect(card.purchasable).toBe(false);
  });
});
