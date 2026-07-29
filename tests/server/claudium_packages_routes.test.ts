// Unit coverage for the Claudium Packages admin route layer
// (server/claudium_packages_routes.ts). Mirrors shop_products_routes.test.ts's
// harness pattern exactly (requireAdmin over a faked admin-auth db via
// server/admin.ts's setAdminDbForTests; a faked ClaudiumPackagesService;
// withErrors + compose driving the real onion).
process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5433/wocc_claudium_packages_routes';

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('pg', () => ({
  Pool: vi.fn(function Pool() {
    return { query: vi.fn(), connect: vi.fn() };
  }),
}));

import { resetAdminDbForTests, setAdminDbForTests } from '../../server/admin';
import type {
  ClaudiumPackageRecord,
  ClaudiumPackagesService,
} from '../../server/claudium_packages';
import {
  resetClaudiumPackagesServiceForTests,
  routes,
  setClaudiumPackagesServiceForTests,
} from '../../server/claudium_packages_routes';
import { compose } from '../../server/http/compose';
import { withErrors } from '../../server/http/middleware/with_errors';
import type { Ctx, Middleware } from '../../server/http/types';
import { fakeCtx } from './helpers';

const BEARER = `Bearer ${'a'.repeat(64)}`;

function authedAs(roles: string[]): void {
  setAdminDbForTests({
    accountAndScopeForToken: async () => ({ accountId: 1, scope: 'full' }),
    adminRolesForAccount: async () => ({ username: 'op', roles }),
  });
}

function packageRecord(overrides: Partial<ClaudiumPackageRecord> = {}): ClaudiumPackageRecord {
  return {
    id: 3,
    name: 'Starter Pack',
    claudiumAmount: 500,
    bonusAmount: 0,
    price: 499,
    currency: 'USD',
    stripePriceId: null,
    enabled: true,
    displayOrder: 0,
    imageUrl: null,
    discountPercent: 0,
    featured: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function fakeService(overrides: Partial<Record<keyof ClaudiumPackagesService, unknown>>): void {
  setClaudiumPackagesServiceForTests(overrides as unknown as ClaudiumPackagesService);
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
  resetClaudiumPackagesServiceForTests();
});

describe('claudium packages routes: authorization', () => {
  it('401s without a bearer token', async () => {
    const route = routeFor('GET', '/admin/api/shop/packages');
    const ctx = fakeCtx({ method: 'GET', url: '/admin/api/shop/packages' });
    await runRoute(route, ctx);
    expect(captured(ctx).status).toBe(401);
  });

  it('403s a viewer role (no shop.read)', async () => {
    authedAs(['viewer']);
    const route = routeFor('GET', '/admin/api/shop/packages');
    const ctx = fakeCtx({
      method: 'GET',
      url: '/admin/api/shop/packages',
      headers: { authorization: BEARER },
    });
    await runRoute(route, ctx);
    expect(captured(ctx).status).toBe(403);
  });
});

describe('claudium packages routes: list', () => {
  it('lists packages for an admin caller', async () => {
    authedAs(['admin']);
    fakeService({ listPackages: async () => ({ rows: [packageRecord()], total: 1 }) });
    const route = routeFor('GET', '/admin/api/shop/packages');
    const ctx = fakeCtx({
      method: 'GET',
      url: '/admin/api/shop/packages',
      query: { page: '1', limit: '20' },
      headers: { authorization: BEARER },
    });
    await runRoute(route, ctx);
    const { status, body } = captured(ctx);
    expect(status).toBe(200);
    expect(body).toEqual({
      success: true,
      error: null,
      data: { rows: [packageRecord()], total: 1, page: 1, limit: 20 },
    });
  });
});

describe('claudium packages routes: create', () => {
  it('creates a package for an admin caller', async () => {
    authedAs(['admin']);
    fakeService({ createPackage: async () => ({ ok: true, pkg: packageRecord() }) });
    const route = routeFor('POST', '/admin/api/shop/packages');
    const ctx = fakeCtx({
      method: 'POST',
      url: '/admin/api/shop/packages',
      headers: { authorization: BEARER },
      body: { name: 'Starter Pack', claudiumAmount: 500, price: 499 },
    });
    await runRoute(route, ctx);
    const { status, body } = captured(ctx);
    expect(status).toBe(200);
    expect(body).toEqual({ success: true, error: null, data: packageRecord() });
  });

  it('422s a missing required field (claudiumAmount)', async () => {
    authedAs(['admin']);
    const route = routeFor('POST', '/admin/api/shop/packages');
    const ctx = fakeCtx({
      method: 'POST',
      url: '/admin/api/shop/packages',
      headers: { authorization: BEARER },
      body: { name: 'Starter Pack', price: 499 },
    });
    await runRoute(route, ctx);
    expect(captured(ctx).status).toBe(422);
  });
});

describe('claudium packages routes: get/update/delete by id', () => {
  it('gets a package by id', async () => {
    authedAs(['admin']);
    fakeService({ getPackage: async () => packageRecord() });
    const route = routeFor('GET', '/admin/api/shop/packages/:id');
    const ctx = fakeCtx({
      method: 'GET',
      url: '/admin/api/shop/packages/3',
      params: { id: '3' },
      headers: { authorization: BEARER },
    });
    await runRoute(route, ctx);
    const { status, body } = captured(ctx);
    expect(status).toBe(200);
    expect(body).toEqual({ success: true, error: null, data: packageRecord() });
  });

  it('404s a missing package', async () => {
    authedAs(['admin']);
    fakeService({ getPackage: async () => null });
    const route = routeFor('GET', '/admin/api/shop/packages/:id');
    const ctx = fakeCtx({
      method: 'GET',
      url: '/admin/api/shop/packages/999',
      params: { id: '999' },
      headers: { authorization: BEARER },
    });
    await runRoute(route, ctx);
    expect(captured(ctx).status).toBe(404);
  });

  it('updates a package via POST to the plain :id path', async () => {
    authedAs(['admin']);
    fakeService({
      updatePackage: async () => ({ ok: true, pkg: packageRecord({ name: 'Renamed' }) }),
    });
    const route = routeFor('POST', '/admin/api/shop/packages/:id');
    const ctx = fakeCtx({
      method: 'POST',
      url: '/admin/api/shop/packages/3',
      params: { id: '3' },
      headers: { authorization: BEARER },
      body: { name: 'Renamed' },
    });
    await runRoute(route, ctx);
    const { status, body } = captured(ctx);
    expect(status).toBe(200);
    expect(body).toEqual({ success: true, error: null, data: packageRecord({ name: 'Renamed' }) });
  });

  it('404s updating a missing package', async () => {
    authedAs(['admin']);
    fakeService({ updatePackage: async () => ({ ok: false, error: 'not_found' }) });
    const route = routeFor('POST', '/admin/api/shop/packages/:id');
    const ctx = fakeCtx({
      method: 'POST',
      url: '/admin/api/shop/packages/999',
      params: { id: '999' },
      headers: { authorization: BEARER },
      body: { name: 'Renamed' },
    });
    await runRoute(route, ctx);
    expect(captured(ctx).status).toBe(404);
  });

  it('deletes a package via the /:id/delete suffix', async () => {
    authedAs(['admin']);
    fakeService({ deletePackage: async () => true });
    const route = routeFor('POST', '/admin/api/shop/packages/:id/delete');
    const ctx = fakeCtx({
      method: 'POST',
      url: '/admin/api/shop/packages/3/delete',
      params: { id: '3' },
      headers: { authorization: BEARER },
    });
    await runRoute(route, ctx);
    const { status, body } = captured(ctx);
    expect(status).toBe(200);
    expect(body).toEqual({ success: true, error: null, data: { ok: true } });
  });

  it('404s deleting a missing package', async () => {
    authedAs(['admin']);
    fakeService({ deletePackage: async () => false });
    const route = routeFor('POST', '/admin/api/shop/packages/:id/delete');
    const ctx = fakeCtx({
      method: 'POST',
      url: '/admin/api/shop/packages/999/delete',
      params: { id: '999' },
      headers: { authorization: BEARER },
    });
    await runRoute(route, ctx);
    expect(captured(ctx).status).toBe(404);
  });
});

describe('claudium packages routes: route table shape', () => {
  it('registers exactly the five CRUD routes, every one admin-surface with the admin envelope', () => {
    expect(routes.map((r) => `${r.method} ${r.path}`).sort()).toEqual(
      [
        'GET /admin/api/shop/packages',
        'POST /admin/api/shop/packages',
        'GET /admin/api/shop/packages/:id',
        'POST /admin/api/shop/packages/:id',
        'POST /admin/api/shop/packages/:id/delete',
      ].sort(),
    );
    for (const r of routes) {
      expect(r.surface).toBe('admin');
      expect(r.meta?.envelope).toBe('admin');
    }
  });

  it('marks every :id route operator-scoped', () => {
    for (const r of routes.filter((r) => r.path.includes(':id'))) {
      expect(r.meta?.requireOwned).toEqual({ kind: 'claudium_package', ownerScope: 'operator' });
    }
  });
});
