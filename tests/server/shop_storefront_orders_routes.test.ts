// Unit coverage for the player-facing "my orders" storefront route layer
// (server/shop_storefront_orders_routes.ts): requireAccount-gated create/list,
// requireOwned-gated get. The accountId is always the caller's own; these
// tests specifically pin that a client-supplied accountId can never leak into
// ShopOrdersService.createOrder, and that a non-owned order 404s before its
// handler runs (mirrors tests/server/http/ownership_coverage.test.ts's
// generic BOLA sweep, but exercised directly here per-scenario).
process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5433/wocc_storefront_orders';

import { afterEach, describe, expect, it } from 'vitest';
import { compose } from '../../server/http/compose';
import { withErrors } from '../../server/http/middleware/with_errors';
import type { Ctx, Middleware } from '../../server/http/types';
import type { ShopOrderDetail, ShopOrdersService } from '../../server/shop_orders';
import {
  resetStorefrontOrdersAuthDbForTests,
  resetStorefrontOrdersServiceForTests,
  routes,
  setStorefrontOrdersAuthDbForTests,
  setStorefrontOrdersServiceForTests,
} from '../../server/shop_storefront_orders_routes';
import { fakeCtx } from './helpers';

const VALID_TOKEN = 'a'.repeat(64);
const BEARER = `Bearer ${VALID_TOKEN}`;
const CALLER_ACCOUNT_ID = 7;

const NOT_LOCKED = {
  locked: false,
  banned: false,
  suspendedUntil: null,
  reason: '',
  message: '',
  chatMutedUntil: null,
  chatStrikes: 0,
};

function authedAs(scope: 'read' | 'full' = 'full'): void {
  setStorefrontOrdersAuthDbForTests({
    accountAndScopeForToken: async () => ({ accountId: CALLER_ACCOUNT_ID, scope }),
    moderationStatusForAccount: async () => NOT_LOCKED,
  });
}

function orderDetail(overrides: Partial<ShopOrderDetail> = {}): ShopOrderDetail {
  return {
    id: 5,
    accountId: CALLER_ACCOUNT_ID,
    accountUsername: 'playerOne',
    status: 'pending',
    currency: 'gold',
    totalAmount: 200,
    note: '',
    createdByAdminId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    items: [
      {
        id: 1,
        productId: 1,
        productSku: 'sword-01',
        productName: 'Iron Sword',
        unitPrice: 100,
        quantity: 2,
        lineTotal: 200,
      },
    ],
    history: [
      {
        id: 1,
        fromStatus: null,
        toStatus: 'pending',
        adminAccountId: null,
        note: '',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    ...overrides,
  };
}

function fakeService(overrides: Partial<Record<keyof ShopOrdersService, unknown>>): void {
  setStorefrontOrdersServiceForTests(overrides as unknown as ShopOrdersService);
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
  resetStorefrontOrdersAuthDbForTests();
  resetStorefrontOrdersServiceForTests();
});

describe('storefront orders routes: authorization', () => {
  it('401s create without a bearer token', async () => {
    const route = routeFor('POST', '/api/shop/orders');
    const ctx = fakeCtx({ method: 'POST', url: '/api/shop/orders', body: {} });
    await runRoute(route, ctx);
    expect(captured(ctx).status).toBe(401);
  });

  it('401s list without a bearer token', async () => {
    const route = routeFor('GET', '/api/shop/orders');
    const ctx = fakeCtx({ method: 'GET', url: '/api/shop/orders' });
    await runRoute(route, ctx);
    expect(captured(ctx).status).toBe(401);
  });

  it('403s a read-scope token on create (mutation requires active/full)', async () => {
    authedAs('read');
    const route = routeFor('POST', '/api/shop/orders');
    const ctx = fakeCtx({
      method: 'POST',
      url: '/api/shop/orders',
      headers: { authorization: BEARER },
      body: { currency: 'gold', items: [{ productId: 1, quantity: 1 }] },
    });
    await runRoute(route, ctx);
    expect(captured(ctx).status).toBe(403);
  });
});

describe('storefront orders routes: create', () => {
  it('creates an order, forcing accountId to the authenticated caller', async () => {
    authedAs('full');
    let receivedInput: unknown;
    fakeService({
      createOrder: async (input: unknown) => {
        receivedInput = input;
        return { ok: true, order: orderDetail() };
      },
    });
    const route = routeFor('POST', '/api/shop/orders');
    const ctx = fakeCtx({
      method: 'POST',
      url: '/api/shop/orders',
      headers: { authorization: BEARER },
      body: { currency: 'gold', items: [{ productId: 1, quantity: 2 }] },
    });
    await runRoute(route, ctx);
    const { status, body } = captured(ctx);
    expect(status).toBe(200);
    expect(body).toEqual(orderDetail());
    expect(receivedInput).toMatchObject({ accountId: CALLER_ACCOUNT_ID, currency: 'gold' });
  });

  it('ignores a client-supplied accountId in the body (never trusted)', async () => {
    authedAs('full');
    let receivedInput: { accountId?: number } | undefined;
    fakeService({
      createOrder: async (input: { accountId?: number }) => {
        receivedInput = input;
        return { ok: true, order: orderDetail() };
      },
    });
    const route = routeFor('POST', '/api/shop/orders');
    const ctx = fakeCtx({
      method: 'POST',
      url: '/api/shop/orders',
      headers: { authorization: BEARER },
      // accountId is not even a field the schema decodes, but prove the
      // service call never sees a value other than the caller's own.
      body: { accountId: 999, currency: 'gold', items: [{ productId: 1, quantity: 1 }] },
    });
    await runRoute(route, ctx);
    expect(receivedInput?.accountId).toBe(CALLER_ACCOUNT_ID);
  });

  it('400s insufficient_stock as shop.out_of_stock', async () => {
    authedAs('full');
    fakeService({
      createOrder: async () => ({ ok: false, error: 'insufficient_stock', productId: 1 }),
    });
    const route = routeFor('POST', '/api/shop/orders');
    const ctx = fakeCtx({
      method: 'POST',
      url: '/api/shop/orders',
      headers: { authorization: BEARER },
      body: { currency: 'gold', items: [{ productId: 1, quantity: 999 }] },
    });
    await runRoute(route, ctx);
    const { status, body } = captured(ctx);
    expect(status).toBe(400);
    expect((body as { code: string }).code).toBe('shop.out_of_stock');
  });

  it('422s an empty items array at the schema layer', async () => {
    authedAs('full');
    const route = routeFor('POST', '/api/shop/orders');
    const ctx = fakeCtx({
      method: 'POST',
      url: '/api/shop/orders',
      headers: { authorization: BEARER },
      body: { currency: 'gold', items: [] },
    });
    await runRoute(route, ctx);
    expect(captured(ctx).status).toBe(422);
  });
});

describe('storefront orders routes: list', () => {
  it('lists only the caller\'s own orders (accountId forced server-side)', async () => {
    authedAs('read');
    let receivedParams: Record<string, unknown> | undefined;
    fakeService({
      listOrders: async (params: Record<string, unknown>) => {
        receivedParams = params;
        return { rows: [orderDetail()], total: 1 };
      },
    });
    const route = routeFor('GET', '/api/shop/orders');
    const ctx = fakeCtx({
      method: 'GET',
      url: '/api/shop/orders',
      headers: { authorization: BEARER },
    });
    await runRoute(route, ctx);
    const { status, body } = captured(ctx);
    expect(status).toBe(200);
    expect(body).toEqual({ rows: [orderDetail()], total: 1, page: 1, limit: 20 });
    expect(receivedParams?.accountId).toBe(CALLER_ACCOUNT_ID);
  });
});

describe('storefront orders routes: get by id (ownership-checked)', () => {
  it('returns the order when it belongs to the caller', async () => {
    authedAs('read');
    fakeService({ getOrder: async () => orderDetail() });
    const route = routeFor('GET', '/api/shop/orders/:id');
    const ctx = fakeCtx({
      method: 'GET',
      url: '/api/shop/orders/5',
      params: { id: '5' },
      headers: { authorization: BEARER },
    });
    await runRoute(route, ctx);
    const { status, body } = captured(ctx);
    expect(status).toBe(200);
    expect(body).toEqual(orderDetail());
  });

  it('404s an order belonging to a different account (anti-enumeration)', async () => {
    authedAs('read');
    fakeService({ getOrder: async () => orderDetail({ accountId: 999 }) });
    const route = routeFor('GET', '/api/shop/orders/:id');
    const ctx = fakeCtx({
      method: 'GET',
      url: '/api/shop/orders/5',
      params: { id: '5' },
      headers: { authorization: BEARER },
    });
    await runRoute(route, ctx);
    const { status, body } = captured(ctx);
    expect(status).toBe(404);
    expect((body as { code: string }).code).toBe('shop.not_found');
  });

  it('404s a missing order', async () => {
    authedAs('read');
    fakeService({ getOrder: async () => null });
    const route = routeFor('GET', '/api/shop/orders/:id');
    const ctx = fakeCtx({
      method: 'GET',
      url: '/api/shop/orders/999',
      params: { id: '999' },
      headers: { authorization: BEARER },
    });
    await runRoute(route, ctx);
    expect(captured(ctx).status).toBe(404);
  });

  it('422s a non-numeric id before any service call', async () => {
    authedAs('read');
    let called = false;
    fakeService({
      getOrder: async () => {
        called = true;
        return null;
      },
    });
    const route = routeFor('GET', '/api/shop/orders/:id');
    const ctx = fakeCtx({
      method: 'GET',
      url: '/api/shop/orders/not-a-number',
      params: { id: 'not-a-number' },
      headers: { authorization: BEARER },
    });
    await runRoute(route, ctx);
    expect(captured(ctx).status).toBe(422);
    expect(called).toBe(false);
  });
});

describe('storefront orders routes: route table shape', () => {
  it('registers exactly the three routes, every one on the api surface', () => {
    expect(routes.map((r) => `${r.method} ${r.path}`).sort()).toEqual(
      ['POST /api/shop/orders', 'GET /api/shop/orders', 'GET /api/shop/orders/:id'].sort(),
    );
    for (const r of routes) {
      expect(r.surface).toBe('api');
    }
  });

  it('marks the :id route account-owned', () => {
    const idRoute = routeFor('GET', '/api/shop/orders/:id');
    expect(idRoute.meta?.requireOwned).toEqual({ kind: 'shop_order', ownerScope: 'account' });
  });
});
