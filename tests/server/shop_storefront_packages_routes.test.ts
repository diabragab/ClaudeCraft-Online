// Unit coverage for the public Claudium Packages storefront route layer
// (server/shop_storefront_packages_routes.ts): anonymous, enabled-only
// browsing over the EXISTING ClaudiumPackagesService (the same class the
// admin surface uses). See shop_storefront_catalog_routes.test.ts for the
// harness pattern this mirrors; this surface carries no admin auth, only the
// public-read rate limit.
process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5433/wocc_storefront_packages';

import { afterEach, describe, expect, it } from 'vitest';
import type {
  ClaudiumPackageRecord,
  ClaudiumPackagesService,
} from '../../server/claudium_packages';
import { compose } from '../../server/http/compose';
import { withErrors } from '../../server/http/middleware/with_errors';
import type { Ctx, Middleware } from '../../server/http/types';
import { resetPublicReadRateLimits } from '../../server/ratelimit';
import {
  resetStorefrontPackagesServiceForTests,
  routes,
  setStorefrontPackagesServiceForTests,
} from '../../server/shop_storefront_packages_routes';
import { fakeCtx } from './helpers';

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
  setStorefrontPackagesServiceForTests(overrides as unknown as ClaudiumPackagesService);
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
  resetStorefrontPackagesServiceForTests();
  resetPublicReadRateLimits();
});

describe('storefront packages routes: list', () => {
  it('lists enabled packages with no auth required', async () => {
    fakeService({ listPackages: async () => ({ rows: [packageRecord()], total: 1 }) });
    const route = routeFor('GET', '/api/shop/packages');
    const ctx = fakeCtx({ method: 'GET', url: '/api/shop/packages' });
    await runRoute(route, ctx);
    const { status, body } = captured(ctx);
    expect(status).toBe(200);
    expect(body).toEqual({ rows: [packageRecord()], total: 1, page: 1, limit: 20 });
  });

  it('forces enabled: true server-side regardless of any client-supplied filter', async () => {
    let receivedParams: Record<string, unknown> | undefined;
    fakeService({
      listPackages: async (params: Record<string, unknown>) => {
        receivedParams = params;
        return { rows: [], total: 0 };
      },
    });
    const route = routeFor('GET', '/api/shop/packages');
    const ctx = fakeCtx({
      method: 'GET',
      url: '/api/shop/packages',
      query: { enabled: 'false' },
    });
    await runRoute(route, ctx);
    expect(receivedParams).toMatchObject({ enabled: true });
  });

  it('forwards a featured filter to the service', async () => {
    let receivedParams: Record<string, unknown> | undefined;
    fakeService({
      listPackages: async (params: Record<string, unknown>) => {
        receivedParams = params;
        return { rows: [], total: 0 };
      },
    });
    const route = routeFor('GET', '/api/shop/packages');
    const ctx = fakeCtx({
      method: 'GET',
      url: '/api/shop/packages',
      query: { featured: 'true' },
    });
    await runRoute(route, ctx);
    expect(receivedParams).toMatchObject({ featured: true, enabled: true });
  });

  it('defaults to sorting by displayOrder ascending', async () => {
    let receivedParams: Record<string, unknown> | undefined;
    fakeService({
      listPackages: async (params: Record<string, unknown>) => {
        receivedParams = params;
        return { rows: [], total: 0 };
      },
    });
    const route = routeFor('GET', '/api/shop/packages');
    const ctx = fakeCtx({ method: 'GET', url: '/api/shop/packages' });
    await runRoute(route, ctx);
    expect(receivedParams).toMatchObject({ sort: 'displayOrder', dir: 'asc' });
  });
});

describe('storefront packages routes: route table shape', () => {
  it('registers exactly the one public route', () => {
    expect(routes.map((r) => `${r.method} ${r.path}`)).toEqual(['GET /api/shop/packages']);
    expect(routes[0]?.surface).toBe('api');
  });
});
