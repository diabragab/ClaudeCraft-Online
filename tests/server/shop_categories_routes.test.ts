// Unit coverage for the shop-categories admin route layer
// (server/shop_categories_routes.ts). Drives the real middleware onion
// (requireAdmin, withBody, requireAdminTarget) via compose, over a faked
// admin-auth db (server/admin.ts's setAdminDbForTests test seam, the SAME
// seam server/admin.ts's own routes use, per tests/server/http/ownership_
// coverage.test.ts's registry-wide sweep) and a faked service
// (shop_categories_routes.ts's own test seam), mirroring
// tests/server/maps_routes.test.ts's pattern for the account-owner surface.
//
// server/db.ts builds a pg Pool at module load and throws if DATABASE_URL is
// unset; shop_categories_routes.ts imports it (via server/admin.ts and its
// own service singleton), so set a dummy URL and mock pg (the pool never
// connects: everything routes through the fakes below).
process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5433/wocc_shop_categories_routes';

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
import type { ShopCategoriesService, ShopCategoryRecord } from '../../server/shop_categories';
import {
  resetShopCategoriesServiceForTests,
  routes,
  setShopCategoriesServiceForTests,
} from '../../server/shop_categories_routes';
import { fakeCtx } from './helpers';

const BEARER = `Bearer ${'a'.repeat(64)}`;

function authedAs(roles: string[]): void {
  setAdminDbForTests({
    accountAndScopeForToken: async () => ({ accountId: 1, scope: 'full' }),
    adminRolesForAccount: async () => ({ username: 'op', roles }),
  });
}

function categoryRecord(overrides: Partial<ShopCategoryRecord> = {}): ShopCategoryRecord {
  return {
    id: 5,
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

/** Install a fake ShopCategoriesService (only the members a test drives need overriding). */
function fakeService(overrides: Partial<Record<keyof ShopCategoriesService, unknown>>): void {
  setShopCategoriesServiceForTests(overrides as unknown as ShopCategoriesService);
}

function routeFor(method: string, path: string) {
  const route = routes.find((r) => r.method === method && r.path === path);
  if (!route) throw new Error(`no route ${method} ${path}`);
  return route;
}

/** Drive a route's real middleware + handler under withErrors (dispatcher shape). */
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
  resetShopCategoriesServiceForTests();
});

describe('shop categories routes: authorization', () => {
  it('401s without a bearer token', async () => {
    const route = routeFor('GET', '/admin/api/shop/categories');
    const ctx = fakeCtx({ method: 'GET', url: '/admin/api/shop/categories' });
    await runRoute(route, ctx);
    expect(captured(ctx).status).toBe(401);
  });

  it('403s a staff account without shop.read (viewer role)', async () => {
    authedAs(['viewer']);
    const route = routeFor('GET', '/admin/api/shop/categories');
    const ctx = fakeCtx({
      method: 'GET',
      url: '/admin/api/shop/categories',
      headers: { authorization: BEARER },
    });
    await runRoute(route, ctx);
    expect(captured(ctx).status).toBe(403);
  });

  it('403s a shop.read-only role on a write (moderator lacks shop.manage)', async () => {
    authedAs(['moderator']);
    const route = routeFor('POST', '/admin/api/shop/categories');
    const ctx = fakeCtx({
      method: 'POST',
      url: '/admin/api/shop/categories',
      headers: { authorization: BEARER },
      body: { name: 'Weapons', slug: 'weapons' },
    });
    await runRoute(route, ctx);
    expect(captured(ctx).status).toBe(403);
  });
});

describe('shop categories routes: list', () => {
  it('lists categories for an admin caller', async () => {
    authedAs(['admin']);
    fakeService({
      listCategories: async () => ({ rows: [categoryRecord()], total: 1 }),
    });
    const route = routeFor('GET', '/admin/api/shop/categories');
    const ctx = fakeCtx({
      method: 'GET',
      url: '/admin/api/shop/categories',
      query: { page: '1', limit: '20' },
      headers: { authorization: BEARER },
    });
    await runRoute(route, ctx);
    const { status, body } = captured(ctx);
    expect(status).toBe(200);
    expect(body).toEqual({
      success: true,
      error: null,
      data: { rows: [categoryRecord()], total: 1, page: 1, limit: 20 },
    });
  });

  it('422s an out-of-range limit', async () => {
    authedAs(['admin']);
    const route = routeFor('GET', '/admin/api/shop/categories');
    const ctx = fakeCtx({
      method: 'GET',
      url: '/admin/api/shop/categories',
      query: { limit: '1000' },
      headers: { authorization: BEARER },
    });
    await runRoute(route, ctx);
    expect(captured(ctx).status).toBe(422);
  });
});

describe('shop categories routes: create', () => {
  it('creates a category for a superadmin caller', async () => {
    authedAs(['superadmin']);
    fakeService({
      createCategory: async () => ({ ok: true, category: categoryRecord() }),
    });
    const route = routeFor('POST', '/admin/api/shop/categories');
    const ctx = fakeCtx({
      method: 'POST',
      url: '/admin/api/shop/categories',
      headers: { authorization: BEARER },
      body: { name: 'Weapons', slug: 'weapons' },
    });
    await runRoute(route, ctx);
    const { status, body } = captured(ctx);
    expect(status).toBe(200);
    expect(body).toEqual({ success: true, error: null, data: categoryRecord() });
  });

  it('400s a domain-rule rejection as shop.invalid_input', async () => {
    authedAs(['admin']);
    fakeService({
      createCategory: async () => ({ ok: false, error: 'invalid_slug' }),
    });
    const route = routeFor('POST', '/admin/api/shop/categories');
    const ctx = fakeCtx({
      method: 'POST',
      url: '/admin/api/shop/categories',
      headers: { authorization: BEARER },
      body: { name: 'Weapons', slug: 'weapons' },
    });
    await runRoute(route, ctx);
    const { status, body } = captured(ctx);
    expect(status).toBe(400);
    expect(body).toEqual({ success: false, data: null, error: 'shop.invalid_input' });
  });
});

describe('shop categories routes: get/update/delete by id', () => {
  it('gets a category by id', async () => {
    authedAs(['admin']);
    fakeService({ getCategory: async () => categoryRecord() });
    const route = routeFor('GET', '/admin/api/shop/categories/:id');
    const ctx = fakeCtx({
      method: 'GET',
      url: '/admin/api/shop/categories/5',
      params: { id: '5' },
      headers: { authorization: BEARER },
    });
    await runRoute(route, ctx);
    const { status, body } = captured(ctx);
    expect(status).toBe(200);
    expect(body).toEqual({ success: true, error: null, data: categoryRecord() });
  });

  it('404s a missing category', async () => {
    authedAs(['admin']);
    fakeService({ getCategory: async () => null });
    const route = routeFor('GET', '/admin/api/shop/categories/:id');
    const ctx = fakeCtx({
      method: 'GET',
      url: '/admin/api/shop/categories/999',
      params: { id: '999' },
      headers: { authorization: BEARER },
    });
    await runRoute(route, ctx);
    const { status, body } = captured(ctx);
    expect(status).toBe(404);
    expect(body).toEqual({ success: false, data: null, error: 'shop.not_found' });
  });

  it('updates a category via POST to the plain :id path', async () => {
    authedAs(['admin']);
    fakeService({
      updateCategory: async () => ({ ok: true, category: categoryRecord({ name: 'Renamed' }) }),
    });
    const route = routeFor('POST', '/admin/api/shop/categories/:id');
    const ctx = fakeCtx({
      method: 'POST',
      url: '/admin/api/shop/categories/5',
      params: { id: '5' },
      headers: { authorization: BEARER },
      body: { name: 'Renamed' },
    });
    await runRoute(route, ctx);
    const { status, body } = captured(ctx);
    expect(status).toBe(200);
    expect(body).toEqual({ success: true, error: null, data: categoryRecord({ name: 'Renamed' }) });
  });

  it('deletes a category via the /:id/delete suffix', async () => {
    authedAs(['admin']);
    fakeService({ deleteCategory: async () => true });
    const route = routeFor('POST', '/admin/api/shop/categories/:id/delete');
    const ctx = fakeCtx({
      method: 'POST',
      url: '/admin/api/shop/categories/5/delete',
      params: { id: '5' },
      headers: { authorization: BEARER },
    });
    await runRoute(route, ctx);
    const { status, body } = captured(ctx);
    expect(status).toBe(200);
    expect(body).toEqual({ success: true, error: null, data: { ok: true } });
  });

  it('404s deleting a missing category', async () => {
    authedAs(['admin']);
    fakeService({ deleteCategory: async () => false });
    const route = routeFor('POST', '/admin/api/shop/categories/:id/delete');
    const ctx = fakeCtx({
      method: 'POST',
      url: '/admin/api/shop/categories/999/delete',
      params: { id: '999' },
      headers: { authorization: BEARER },
    });
    await runRoute(route, ctx);
    expect(captured(ctx).status).toBe(404);
  });
});

describe('shop categories routes: route table shape', () => {
  it('registers exactly the five CRUD routes, every one admin-surface with the admin envelope', () => {
    expect(routes.map((r) => `${r.method} ${r.path}`).sort()).toEqual(
      [
        'GET /admin/api/shop/categories',
        'POST /admin/api/shop/categories',
        'GET /admin/api/shop/categories/:id',
        'POST /admin/api/shop/categories/:id',
        'POST /admin/api/shop/categories/:id/delete',
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
      expect(r.meta?.requireOwned).toEqual({ kind: 'shop_category', ownerScope: 'operator' });
    }
  });
});
