// Unit coverage for the shop-inventory admin route layer
// (server/shop_inventory_routes.ts). See shop_categories_routes.test.ts for
// the harness pattern this mirrors.
process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5433/wocc_shop_inventory_routes';

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
import type { ShopInventoryRecord, ShopInventoryService } from '../../server/shop_inventory';
import {
  resetShopInventoryServiceForTests,
  routes,
  setShopInventoryServiceForTests,
} from '../../server/shop_inventory_routes';
import { fakeCtx } from './helpers';

const BEARER = `Bearer ${'a'.repeat(64)}`;

function authedAs(roles: string[]): void {
  setAdminDbForTests({
    accountAndScopeForToken: async () => ({ accountId: 1, scope: 'full' }),
    adminRolesForAccount: async () => ({ username: 'op', roles }),
  });
}

function inventoryRecord(overrides: Partial<ShopInventoryRecord> = {}): ShopInventoryRecord {
  return {
    id: 3,
    productId: 9,
    productSku: 'sword-01',
    productName: 'Iron Sword',
    quantityOnHand: 50,
    quantityReserved: 0,
    lowStockThreshold: 10,
    unlimited: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function fakeService(overrides: Partial<Record<keyof ShopInventoryService, unknown>>): void {
  setShopInventoryServiceForTests(overrides as unknown as ShopInventoryService);
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
  resetShopInventoryServiceForTests();
});

describe('shop inventory routes: authorization', () => {
  it('401s without a bearer token', async () => {
    const route = routeFor('GET', '/admin/api/shop/inventory');
    const ctx = fakeCtx({ method: 'GET', url: '/admin/api/shop/inventory' });
    await runRoute(route, ctx);
    expect(captured(ctx).status).toBe(401);
  });

  it('403s a viewer role (no shop.read)', async () => {
    authedAs(['viewer']);
    const route = routeFor('GET', '/admin/api/shop/inventory');
    const ctx = fakeCtx({
      method: 'GET',
      url: '/admin/api/shop/inventory',
      headers: { authorization: BEARER },
    });
    await runRoute(route, ctx);
    expect(captured(ctx).status).toBe(403);
  });
});

describe('shop inventory routes: list', () => {
  it('lists inventory rows for an admin caller', async () => {
    authedAs(['admin']);
    fakeService({ listInventory: async () => ({ rows: [inventoryRecord()], total: 1 }) });
    const route = routeFor('GET', '/admin/api/shop/inventory');
    const ctx = fakeCtx({
      method: 'GET',
      url: '/admin/api/shop/inventory',
      query: { page: '1', limit: '20' },
      headers: { authorization: BEARER },
    });
    await runRoute(route, ctx);
    const { status, body } = captured(ctx);
    expect(status).toBe(200);
    expect(body).toEqual({
      success: true,
      error: null,
      data: { rows: [inventoryRecord()], total: 1, page: 1, limit: 20 },
    });
  });
});

describe('shop inventory routes: create', () => {
  it('starts tracking a product for an admin caller', async () => {
    authedAs(['admin']);
    fakeService({ createInventory: async () => ({ ok: true, inventory: inventoryRecord() }) });
    const route = routeFor('POST', '/admin/api/shop/inventory');
    const ctx = fakeCtx({
      method: 'POST',
      url: '/admin/api/shop/inventory',
      headers: { authorization: BEARER },
      body: { productId: 9, quantityOnHand: 50 },
    });
    await runRoute(route, ctx);
    const { status, body } = captured(ctx);
    expect(status).toBe(200);
    expect(body).toEqual({ success: true, error: null, data: inventoryRecord() });
  });

  it('404s an unknown product as shop.not_found', async () => {
    authedAs(['admin']);
    fakeService({ createInventory: async () => ({ ok: false, error: 'product_not_found' }) });
    const route = routeFor('POST', '/admin/api/shop/inventory');
    const ctx = fakeCtx({
      method: 'POST',
      url: '/admin/api/shop/inventory',
      headers: { authorization: BEARER },
      body: { productId: 999 },
    });
    await runRoute(route, ctx);
    const { status, body } = captured(ctx);
    expect(status).toBe(404);
    expect(body).toEqual({ success: false, data: null, error: 'shop.not_found' });
  });

  it('409s a product that is already tracked (already_tracked maps to shop.invalid_input)', async () => {
    authedAs(['admin']);
    fakeService({ createInventory: async () => ({ ok: false, error: 'already_tracked' }) });
    const route = routeFor('POST', '/admin/api/shop/inventory');
    const ctx = fakeCtx({
      method: 'POST',
      url: '/admin/api/shop/inventory',
      headers: { authorization: BEARER },
      body: { productId: 9 },
    });
    await runRoute(route, ctx);
    const { status, body } = captured(ctx);
    expect(status).toBe(400);
    expect(body).toEqual({ success: false, data: null, error: 'shop.invalid_input' });
  });
});

describe('shop inventory routes: get/update/delete by id', () => {
  it('gets an inventory row by id', async () => {
    authedAs(['admin']);
    fakeService({ getInventory: async () => inventoryRecord() });
    const route = routeFor('GET', '/admin/api/shop/inventory/:id');
    const ctx = fakeCtx({
      method: 'GET',
      url: '/admin/api/shop/inventory/3',
      params: { id: '3' },
      headers: { authorization: BEARER },
    });
    await runRoute(route, ctx);
    const { status, body } = captured(ctx);
    expect(status).toBe(200);
    expect(body).toEqual({ success: true, error: null, data: inventoryRecord() });
  });

  it('404s a missing inventory row', async () => {
    authedAs(['admin']);
    fakeService({ getInventory: async () => null });
    const route = routeFor('GET', '/admin/api/shop/inventory/:id');
    const ctx = fakeCtx({
      method: 'GET',
      url: '/admin/api/shop/inventory/999',
      params: { id: '999' },
      headers: { authorization: BEARER },
    });
    await runRoute(route, ctx);
    expect(captured(ctx).status).toBe(404);
  });

  it('adjusts stock via POST to the plain :id path', async () => {
    authedAs(['admin']);
    fakeService({
      updateInventory: async () => ({
        ok: true,
        inventory: inventoryRecord({ quantityOnHand: 40 }),
      }),
    });
    const route = routeFor('POST', '/admin/api/shop/inventory/:id');
    const ctx = fakeCtx({
      method: 'POST',
      url: '/admin/api/shop/inventory/3',
      params: { id: '3' },
      headers: { authorization: BEARER },
      body: { quantityOnHand: 40, reason: 'sold 10' },
    });
    await runRoute(route, ctx);
    const { status, body } = captured(ctx);
    expect(status).toBe(200);
    expect(body).toEqual({
      success: true,
      error: null,
      data: inventoryRecord({ quantityOnHand: 40 }),
    });
  });

  it('422s a negative quantityOnHand at the shape layer', async () => {
    authedAs(['admin']);
    const route = routeFor('POST', '/admin/api/shop/inventory/:id');
    const ctx = fakeCtx({
      method: 'POST',
      url: '/admin/api/shop/inventory/3',
      params: { id: '3' },
      headers: { authorization: BEARER },
      body: { quantityOnHand: -1 },
    });
    await runRoute(route, ctx);
    expect(captured(ctx).status).toBe(422);
  });

  it('stops tracking a product via the /:id/delete suffix', async () => {
    authedAs(['admin']);
    fakeService({ deleteInventory: async () => true });
    const route = routeFor('POST', '/admin/api/shop/inventory/:id/delete');
    const ctx = fakeCtx({
      method: 'POST',
      url: '/admin/api/shop/inventory/3/delete',
      params: { id: '3' },
      headers: { authorization: BEARER },
    });
    await runRoute(route, ctx);
    const { status, body } = captured(ctx);
    expect(status).toBe(200);
    expect(body).toEqual({ success: true, error: null, data: { ok: true } });
  });
});

describe('shop inventory routes: route table shape', () => {
  it('registers exactly the five CRUD routes, every one admin-surface with the admin envelope', () => {
    expect(routes.map((r) => `${r.method} ${r.path}`).sort()).toEqual(
      [
        'GET /admin/api/shop/inventory',
        'POST /admin/api/shop/inventory',
        'GET /admin/api/shop/inventory/:id',
        'POST /admin/api/shop/inventory/:id',
        'POST /admin/api/shop/inventory/:id/delete',
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
      expect(r.meta?.requireOwned).toEqual({ kind: 'shop_inventory', ownerScope: 'operator' });
    }
  });
});
