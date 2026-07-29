// Unit coverage for the shop-products admin route layer
// (server/shop_products_routes.ts). See shop_categories_routes.test.ts for the
// harness pattern this mirrors (requireAdmin, the SAME instance server/admin.ts's
// own routes mount, over a faked admin-auth db via server/admin.ts's
// setAdminDbForTests; a faked ShopProductsService; withErrors + compose
// driving the real onion).
process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5433/wocc_shop_products_routes';

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('pg', () => ({
  Pool: vi.fn(function Pool() {
    return { query: vi.fn(), connect: vi.fn() };
  }),
}));

import { resetAdminDbForTests, setAdminDbForTests } from '../../server/admin';
import { compose } from '../../server/http/compose';
import { withErrors } from '../../server/http/middleware/with_errors';
import type { Ctx, Middleware } from '../../server/http/types';
import type { ShopProductRecord, ShopProductsService } from '../../server/shop_products';
import {
  resetShopProductsServiceForTests,
  routes,
  setShopProductsServiceForTests,
} from '../../server/shop_products_routes';
import { fakeCtx } from './helpers';

const BEARER = `Bearer ${'a'.repeat(64)}`;

function authedAs(roles: string[]): void {
  setAdminDbForTests({
    accountAndScopeForToken: async () => ({ accountId: 1, scope: 'full' }),
    adminRolesForAccount: async () => ({ username: 'op', roles }),
  });
}

function productRecord(overrides: Partial<ShopProductRecord> = {}): ShopProductRecord {
  return {
    id: 9,
    sku: 'sword-01',
    name: 'Iron Sword',
    slug: 'iron-sword',
    description: '',
    categoryId: null,
    priceGoldCopper: 1000,
    priceClaudium: null,
    priceUsdCents: null,
    railSol: false,
    railUsdc: false,
    railWoc: false,
    status: 'draft',
    featured: false,
    grantKind: 'none',
    grantItemId: null,
    grantQuantity: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function fakeService(overrides: Partial<Record<keyof ShopProductsService, unknown>>): void {
  setShopProductsServiceForTests(overrides as unknown as ShopProductsService);
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
  resetAdminDbForTests();
  resetShopProductsServiceForTests();
});

describe('shop products routes: authorization', () => {
  it('401s without a bearer token', async () => {
    const route = routeFor('GET', '/admin/api/shop/products');
    const ctx = fakeCtx({ method: 'GET', url: '/admin/api/shop/products' });
    await runRoute(route, ctx);
    expect(captured(ctx).status).toBe(401);
  });

  it('403s a viewer role (no shop.read)', async () => {
    authedAs(['viewer']);
    const route = routeFor('GET', '/admin/api/shop/products');
    const ctx = fakeCtx({
      method: 'GET',
      url: '/admin/api/shop/products',
      headers: { authorization: BEARER },
    });
    await runRoute(route, ctx);
    expect(captured(ctx).status).toBe(403);
  });
});

describe('shop products routes: list', () => {
  it('lists products for an admin caller', async () => {
    authedAs(['admin']);
    fakeService({ listProducts: async () => ({ rows: [productRecord()], total: 1 }) });
    const route = routeFor('GET', '/admin/api/shop/products');
    const ctx = fakeCtx({
      method: 'GET',
      url: '/admin/api/shop/products',
      query: { page: '1', limit: '20' },
      headers: { authorization: BEARER },
    });
    await runRoute(route, ctx);
    const { status, body } = captured(ctx);
    expect(status).toBe(200);
    expect(body).toEqual({
      success: true,
      error: null,
      data: { rows: [productRecord()], total: 1, page: 1, limit: 20 },
    });
  });
});

describe('shop products routes: create', () => {
  it('creates a product for an admin caller', async () => {
    authedAs(['admin']);
    fakeService({ createProduct: async () => ({ ok: true, product: productRecord() }) });
    const route = routeFor('POST', '/admin/api/shop/products');
    const ctx = fakeCtx({
      method: 'POST',
      url: '/admin/api/shop/products',
      headers: { authorization: BEARER },
      body: { sku: 'sword-01', name: 'Iron Sword', slug: 'iron-sword', priceGoldCopper: '1000' },
    });
    await runRoute(route, ctx);
    const { status, body } = captured(ctx);
    expect(status).toBe(200);
    expect(body).toEqual({ success: true, error: null, data: productRecord() });
  });

  it('404s a rejected unknown category as shop.not_found', async () => {
    authedAs(['admin']);
    fakeService({ createProduct: async () => ({ ok: false, error: 'category_not_found' }) });
    const route = routeFor('POST', '/admin/api/shop/products');
    const ctx = fakeCtx({
      method: 'POST',
      url: '/admin/api/shop/products',
      headers: { authorization: BEARER },
      body: {
        sku: 'sword-01',
        name: 'Iron Sword',
        slug: 'iron-sword',
        priceGoldCopper: '1000',
        categoryId: 42,
      },
    });
    await runRoute(route, ctx);
    const { status, body } = captured(ctx);
    expect(status).toBe(404);
    expect(body).toEqual({ success: false, data: null, error: 'shop.not_found' });
  });

  it('400s a no_price rejection as shop.invalid_input', async () => {
    authedAs(['admin']);
    fakeService({ createProduct: async () => ({ ok: false, error: 'no_price' }) });
    const route = routeFor('POST', '/admin/api/shop/products');
    const ctx = fakeCtx({
      method: 'POST',
      url: '/admin/api/shop/products',
      headers: { authorization: BEARER },
      body: { sku: 'sword-01', name: 'Iron Sword', slug: 'iron-sword' },
    });
    await runRoute(route, ctx);
    const { status, body } = captured(ctx);
    expect(status).toBe(400);
    expect(body).toEqual({ success: false, data: null, error: 'shop.invalid_input' });
  });

  it('422s a missing required field (sku)', async () => {
    authedAs(['admin']);
    const route = routeFor('POST', '/admin/api/shop/products');
    const ctx = fakeCtx({
      method: 'POST',
      url: '/admin/api/shop/products',
      headers: { authorization: BEARER },
      body: { name: 'Iron Sword', slug: 'iron-sword' },
    });
    await runRoute(route, ctx);
    expect(captured(ctx).status).toBe(422);
  });
});

describe('shop products routes: get/update/delete by id', () => {
  it('gets a product by id', async () => {
    authedAs(['admin']);
    fakeService({ getProduct: async () => productRecord() });
    const route = routeFor('GET', '/admin/api/shop/products/:id');
    const ctx = fakeCtx({
      method: 'GET',
      url: '/admin/api/shop/products/9',
      params: { id: '9' },
      headers: { authorization: BEARER },
    });
    await runRoute(route, ctx);
    const { status, body } = captured(ctx);
    expect(status).toBe(200);
    expect(body).toEqual({ success: true, error: null, data: productRecord() });
  });

  it('404s a missing product', async () => {
    authedAs(['admin']);
    fakeService({ getProduct: async () => null });
    const route = routeFor('GET', '/admin/api/shop/products/:id');
    const ctx = fakeCtx({
      method: 'GET',
      url: '/admin/api/shop/products/999',
      params: { id: '999' },
      headers: { authorization: BEARER },
    });
    await runRoute(route, ctx);
    expect(captured(ctx).status).toBe(404);
  });

  it('updates a product via POST to the plain :id path', async () => {
    authedAs(['admin']);
    fakeService({
      updateProduct: async () => ({ ok: true, product: productRecord({ name: 'Renamed' }) }),
    });
    const route = routeFor('POST', '/admin/api/shop/products/:id');
    const ctx = fakeCtx({
      method: 'POST',
      url: '/admin/api/shop/products/9',
      params: { id: '9' },
      headers: { authorization: BEARER },
      body: { name: 'Renamed' },
    });
    await runRoute(route, ctx);
    const { status, body } = captured(ctx);
    expect(status).toBe(200);
    expect(body).toEqual({ success: true, error: null, data: productRecord({ name: 'Renamed' }) });
  });

  it('deletes a product via the /:id/delete suffix', async () => {
    authedAs(['admin']);
    fakeService({ deleteProduct: async () => true });
    const route = routeFor('POST', '/admin/api/shop/products/:id/delete');
    const ctx = fakeCtx({
      method: 'POST',
      url: '/admin/api/shop/products/9/delete',
      params: { id: '9' },
      headers: { authorization: BEARER },
    });
    await runRoute(route, ctx);
    const { status, body } = captured(ctx);
    expect(status).toBe(200);
    expect(body).toEqual({ success: true, error: null, data: { ok: true } });
  });
});

describe('shop products routes: route table shape', () => {
  it('registers exactly the five CRUD routes, every one admin-surface with the admin envelope', () => {
    expect(routes.map((r) => `${r.method} ${r.path}`).sort()).toEqual(
      [
        'GET /admin/api/shop/products',
        'POST /admin/api/shop/products',
        'GET /admin/api/shop/products/:id',
        'POST /admin/api/shop/products/:id',
        'POST /admin/api/shop/products/:id/delete',
      ].sort(),
    );
    for (const r of routes) {
      expect(r.surface).toBe('admin');
      expect(r.meta?.envelope).toBe('admin');
    }
  });

  it('marks every :id route operator-scoped', () => {
    const idRoutes = routes.filter((r) => r.path.includes(':id'));
    expect(idRoutes.length).toBe(3);
    for (const r of idRoutes) {
      expect(r.meta?.requireOwned).toEqual({ kind: 'shop_product', ownerScope: 'operator' });
    }
  });
});
