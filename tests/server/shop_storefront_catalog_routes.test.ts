// Unit coverage for the public storefront catalog route layer
// (server/shop_storefront_catalog_routes.ts): anonymous, active-only browsing
// over the EXISTING ShopCategoriesService / ShopProductsService /
// ShopInventoryService. See tests/server/shop_products_routes.test.ts for the
// harness pattern this mirrors, with `withErrors` + compose driving the real
// onion; this surface carries no admin auth, only the public-read rate limit.
process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5433/wocc_storefront_catalog';

import { afterEach, describe, expect, it } from 'vitest';
import { compose } from '../../server/http/compose';
import { withErrors } from '../../server/http/middleware/with_errors';
import type { Ctx, Middleware } from '../../server/http/types';
import { resetPublicReadRateLimits } from '../../server/ratelimit';
import type { ShopCategoriesService, ShopCategoryRecord } from '../../server/shop_categories';
import type { ShopInventoryRecord, ShopInventoryService } from '../../server/shop_inventory';
import type { ShopProductRecord, ShopProductsService } from '../../server/shop_products';
import {
  resetStorefrontCatalogServicesForTests,
  routes,
  setStorefrontCatalogServicesForTests,
} from '../../server/shop_storefront_catalog_routes';
import { fakeCtx } from './helpers';

function categoryRecord(overrides: Partial<ShopCategoryRecord> = {}): ShopCategoryRecord {
  return {
    id: 1,
    name: 'Weapons',
    slug: 'weapons',
    description: '',
    parentId: null,
    sortOrder: 0,
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function productRecord(overrides: Partial<ShopProductRecord> = {}): ShopProductRecord {
  return {
    id: 9,
    sku: 'sword-01',
    name: 'Iron Sword',
    slug: 'iron-sword',
    description: '',
    categoryId: 1,
    priceGoldCopper: 1000,
    priceClaudium: null,
    priceUsdCents: null,
    railSol: false,
    railUsdc: false,
    railWoc: false,
    status: 'active',
    featured: false,
    grantKind: 'none',
    grantItemId: null,
    grantQuantity: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function inventoryRecord(overrides: Partial<ShopInventoryRecord> = {}): ShopInventoryRecord {
  return {
    id: 1,
    productId: 9,
    productSku: 'sword-01',
    productName: 'Iron Sword',
    quantityOnHand: 10,
    quantityReserved: 0,
    lowStockThreshold: 2,
    unlimited: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function fakeServices(overrides: {
  categories?: Partial<Record<keyof ShopCategoriesService, unknown>>;
  products?: Partial<Record<keyof ShopProductsService, unknown>>;
  inventory?: Partial<Record<keyof ShopInventoryService, unknown>>;
}): void {
  setStorefrontCatalogServicesForTests({
    categories: overrides.categories as unknown as ShopCategoriesService,
    products: overrides.products as unknown as ShopProductsService,
    inventory: overrides.inventory as unknown as ShopInventoryService,
  });
}

function routeFor(method: string, path: string) {
  const route = routes.find((r) => r.method === method && r.path === path);
  if (!route) throw new Error(`no route ${method} ${path}`);
  return route;
}

function runRoute(route: (typeof routes)[number], ctx: Ctx): Promise<void> {
  const stack: Middleware[] = [
    withErrors({ surface: route.meta?.envelope }),
    ...(route.middleware ?? []),
    async (c) => {
      await route.handler(c);
    },
  ];
  return compose(stack)(ctx);
}

interface FakeResShape {
  statusCode: number;
  body: string;
}
function captured(ctx: Ctx): { status: number; body: unknown } {
  const fake = ctx.res as unknown as FakeResShape;
  return { status: fake.statusCode, body: fake.body ? JSON.parse(fake.body) : undefined };
}

afterEach(() => {
  resetStorefrontCatalogServicesForTests();
  resetPublicReadRateLimits();
});

describe('storefront catalog routes: categories', () => {
  it('lists only active categories (status forced server-side)', async () => {
    let receivedParams: unknown;
    fakeServices({
      categories: {
        listCategories: async (params: unknown) => {
          receivedParams = params;
          return { rows: [categoryRecord()], total: 1 };
        },
      },
    });
    const route = routeFor('GET', '/api/shop/categories');
    const ctx = fakeCtx({ method: 'GET', url: '/api/shop/categories' });
    await runRoute(route, ctx);
    const { status, body } = captured(ctx);
    expect(status).toBe(200);
    expect(body).toEqual({ rows: [categoryRecord()], total: 1, page: 1, limit: 20 });
    expect(receivedParams).toMatchObject({ status: 'active' });
  });

  it('ignores a client-supplied status override (always forces active)', async () => {
    let receivedParams: { status?: string } | undefined;
    fakeServices({
      categories: {
        listCategories: async (params: { status?: string }) => {
          receivedParams = params;
          return { rows: [], total: 0 };
        },
      },
    });
    const route = routeFor('GET', '/api/shop/categories');
    const ctx = fakeCtx({
      method: 'GET',
      url: '/api/shop/categories',
      query: { status: 'archived' },
    });
    await runRoute(route, ctx);
    expect(receivedParams?.status).toBe('active');
  });

  it('gets an active category by slug', async () => {
    fakeServices({ categories: { getCategoryBySlug: async () => categoryRecord() } });
    const route = routeFor('GET', '/api/shop/categories/:slug');
    const ctx = fakeCtx({
      method: 'GET',
      url: '/api/shop/categories/weapons',
      params: { slug: 'weapons' },
    });
    await runRoute(route, ctx);
    const { status, body } = captured(ctx);
    expect(status).toBe(200);
    expect(body).toEqual(categoryRecord());
  });

  it('404s an archived category (never exposed publicly)', async () => {
    fakeServices({
      categories: { getCategoryBySlug: async () => categoryRecord({ status: 'archived' }) },
    });
    const route = routeFor('GET', '/api/shop/categories/:slug');
    const ctx = fakeCtx({
      method: 'GET',
      url: '/api/shop/categories/weapons',
      params: { slug: 'weapons' },
    });
    await runRoute(route, ctx);
    const { status, body } = captured(ctx);
    expect(status).toBe(404);
    expect((body as { code: string }).code).toBe('shop.not_found');
  });

  it('404s a missing category slug', async () => {
    fakeServices({ categories: { getCategoryBySlug: async () => null } });
    const route = routeFor('GET', '/api/shop/categories/:slug');
    const ctx = fakeCtx({
      method: 'GET',
      url: '/api/shop/categories/ghost',
      params: { slug: 'ghost' },
    });
    await runRoute(route, ctx);
    expect(captured(ctx).status).toBe(404);
  });
});

describe('storefront catalog routes: products', () => {
  it('lists active products merged with computed availability', async () => {
    fakeServices({
      products: { listProducts: async () => ({ rows: [productRecord()], total: 1 }) },
      inventory: { getInventoryByProduct: async () => inventoryRecord() },
    });
    const route = routeFor('GET', '/api/shop/products');
    const ctx = fakeCtx({ method: 'GET', url: '/api/shop/products' });
    await runRoute(route, ctx);
    const { status, body } = captured(ctx);
    expect(status).toBe(200);
    expect(body).toEqual({
      rows: [{ ...productRecord(), availability: 'in_stock' }],
      total: 1,
      page: 1,
      limit: 20,
    });
  });

  it('marks an untracked product unavailable', async () => {
    fakeServices({
      products: { listProducts: async () => ({ rows: [productRecord()], total: 1 }) },
      inventory: { getInventoryByProduct: async () => null },
    });
    const route = routeFor('GET', '/api/shop/products');
    const ctx = fakeCtx({ method: 'GET', url: '/api/shop/products' });
    await runRoute(route, ctx);
    const { body } = captured(ctx);
    expect((body as { rows: { availability: string }[] }).rows[0].availability).toBe('unavailable');
  });

  it('forces status active and forwards featured/categoryId filters', async () => {
    let receivedParams: Record<string, unknown> | undefined;
    fakeServices({
      products: {
        listProducts: async (params: Record<string, unknown>) => {
          receivedParams = params;
          return { rows: [], total: 0 };
        },
      },
      inventory: { getInventoryByProduct: async () => null },
    });
    const route = routeFor('GET', '/api/shop/products');
    const ctx = fakeCtx({
      method: 'GET',
      url: '/api/shop/products',
      query: { featured: 'true', categoryId: '1', status: 'draft' },
    });
    await runRoute(route, ctx);
    expect(receivedParams).toMatchObject({ status: 'active', featured: true, categoryId: 1 });
  });

  it('gets an active product by slug with availability and category', async () => {
    fakeServices({
      products: { getProductBySlug: async () => productRecord() },
      inventory: {
        getInventoryByProduct: async () =>
          inventoryRecord({ quantityOnHand: 1, lowStockThreshold: 2 }),
      },
      categories: { getCategory: async () => categoryRecord() },
    });
    const route = routeFor('GET', '/api/shop/products/:slug');
    const ctx = fakeCtx({
      method: 'GET',
      url: '/api/shop/products/iron-sword',
      params: { slug: 'iron-sword' },
    });
    await runRoute(route, ctx);
    const { status, body } = captured(ctx);
    expect(status).toBe(200);
    expect(body).toEqual({
      ...productRecord(),
      availability: 'low_stock',
      category: categoryRecord(),
    });
  });

  it('404s a draft product (never exposed publicly)', async () => {
    fakeServices({
      products: { getProductBySlug: async () => productRecord({ status: 'draft' }) },
    });
    const route = routeFor('GET', '/api/shop/products/:slug');
    const ctx = fakeCtx({
      method: 'GET',
      url: '/api/shop/products/iron-sword',
      params: { slug: 'iron-sword' },
    });
    await runRoute(route, ctx);
    expect(captured(ctx).status).toBe(404);
  });

  it('404s a missing product slug', async () => {
    fakeServices({ products: { getProductBySlug: async () => null } });
    const route = routeFor('GET', '/api/shop/products/:slug');
    const ctx = fakeCtx({
      method: 'GET',
      url: '/api/shop/products/ghost',
      params: { slug: 'ghost' },
    });
    await runRoute(route, ctx);
    expect(captured(ctx).status).toBe(404);
  });

  it('carries a null category for an uncategorized product', async () => {
    fakeServices({
      products: { getProductBySlug: async () => productRecord({ categoryId: null }) },
      inventory: { getInventoryByProduct: async () => null },
    });
    const route = routeFor('GET', '/api/shop/products/:slug');
    const ctx = fakeCtx({
      method: 'GET',
      url: '/api/shop/products/iron-sword',
      params: { slug: 'iron-sword' },
    });
    await runRoute(route, ctx);
    const { body } = captured(ctx);
    expect((body as { category: unknown }).category).toBeNull();
  });
});

describe('storefront catalog routes: route table shape', () => {
  it('registers exactly the four public read routes, every one on the api surface', () => {
    expect(routes.map((r) => `${r.method} ${r.path}`).sort()).toEqual(
      [
        'GET /api/shop/categories',
        'GET /api/shop/categories/:slug',
        'GET /api/shop/products',
        'GET /api/shop/products/:slug',
      ].sort(),
    );
    for (const r of routes) {
      expect(r.surface).toBe('api');
      expect(r.middleware ?? []).toEqual([]);
    }
  });

  it('marks both :slug routes publicRead (no requireOwned loader expected)', () => {
    const slugRoutes = routes.filter((r) => r.path.includes(':slug'));
    expect(slugRoutes.length).toBe(2);
    for (const r of slugRoutes) {
      expect(r.meta?.publicRead).toBe(true);
    }
  });
});
