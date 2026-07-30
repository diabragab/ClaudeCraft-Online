// Unit coverage for the shop-orders admin route layer
// (server/shop_orders_routes.ts). See shop_products_routes.test.ts for the
// harness pattern this mirrors (requireAdmin, the SAME instance server/admin.ts's
// own routes mount, over a faked admin-auth db via server/admin.ts's
// setAdminDbForTests; a faked ShopOrdersService; withErrors + compose driving
// the real onion).
process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5433/wocc_shop_orders_routes';

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
import type { ShopOrderDetail, ShopOrdersService } from '../../server/shop_orders';
import {
  resetShopOrdersServiceForTests,
  routes,
  setShopOrdersServiceForTests,
} from '../../server/shop_orders_routes';
import { fakeCtx } from './helpers';

const BEARER = `Bearer ${'a'.repeat(64)}`;

function authedAs(roles: string[]): void {
  setAdminDbForTests({
    accountAndScopeForToken: async () => ({ accountId: 1, scope: 'full' }),
    adminRolesForAccount: async () => ({ username: 'op', roles }),
  });
}

function orderDetail(overrides: Partial<ShopOrderDetail> = {}): ShopOrderDetail {
  return {
    id: 5,
    accountId: 7,
    accountUsername: 'playerOne',
    status: 'pending',
    currency: 'gold',
    totalAmount: 200,
    note: '',
    createdByAdminId: 1,
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
        adminAccountId: 1,
        note: '',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    ...overrides,
  };
}

function fakeService(overrides: Partial<Record<keyof ShopOrdersService, unknown>>): void {
  setShopOrdersServiceForTests(overrides as unknown as ShopOrdersService);
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
  resetShopOrdersServiceForTests();
});

describe('shop orders routes: authorization', () => {
  it('401s without a bearer token', async () => {
    const route = routeFor('GET', '/admin/api/shop/orders');
    const ctx = fakeCtx({ method: 'GET', url: '/admin/api/shop/orders' });
    await runRoute(route, ctx);
    expect(captured(ctx).status).toBe(401);
  });

  it('403s a viewer role (no shop.read)', async () => {
    authedAs(['viewer']);
    const route = routeFor('GET', '/admin/api/shop/orders');
    const ctx = fakeCtx({
      method: 'GET',
      url: '/admin/api/shop/orders',
      headers: { authorization: BEARER },
    });
    await runRoute(route, ctx);
    expect(captured(ctx).status).toBe(403);
  });

  it('403s a viewer role on create (no shop.manage)', async () => {
    authedAs(['viewer']);
    const route = routeFor('POST', '/admin/api/shop/orders');
    const ctx = fakeCtx({
      method: 'POST',
      url: '/admin/api/shop/orders',
      headers: { authorization: BEARER },
      body: {},
    });
    await runRoute(route, ctx);
    expect(captured(ctx).status).toBe(403);
  });
});

describe('shop orders routes: list', () => {
  it('lists orders for an admin caller', async () => {
    authedAs(['admin']);
    fakeService({ listOrders: async () => ({ rows: [orderDetail()], total: 1 }) });
    const route = routeFor('GET', '/admin/api/shop/orders');
    const ctx = fakeCtx({
      method: 'GET',
      url: '/admin/api/shop/orders',
      query: { page: '1', limit: '20' },
      headers: { authorization: BEARER },
    });
    await runRoute(route, ctx);
    const { status, body } = captured(ctx);
    expect(status).toBe(200);
    expect(body).toEqual({
      success: true,
      error: null,
      data: { rows: [orderDetail()], total: 1, page: 1, limit: 20 },
    });
  });
});

describe('shop orders routes: create', () => {
  it('creates an order for an admin caller, passing the caller as createdByAdminId', async () => {
    authedAs(['admin']);
    let receivedAdminId: number | null | undefined;
    fakeService({
      createOrder: async (_input: unknown, adminId: number | null) => {
        receivedAdminId = adminId;
        return { ok: true, order: orderDetail() };
      },
    });
    const route = routeFor('POST', '/admin/api/shop/orders');
    const ctx = fakeCtx({
      method: 'POST',
      url: '/admin/api/shop/orders',
      headers: { authorization: BEARER },
      body: { accountId: 7, currency: 'gold', items: [{ productId: 1, quantity: 2 }] },
    });
    await runRoute(route, ctx);
    const { status, body } = captured(ctx);
    expect(status).toBe(200);
    expect(body).toEqual({ success: true, error: null, data: orderDetail() });
    expect(receivedAdminId).toBe(1);
  });

  it('404s account_not_found as shop.not_found', async () => {
    authedAs(['admin']);
    fakeService({ createOrder: async () => ({ ok: false, error: 'account_not_found' }) });
    const route = routeFor('POST', '/admin/api/shop/orders');
    const ctx = fakeCtx({
      method: 'POST',
      url: '/admin/api/shop/orders',
      headers: { authorization: BEARER },
      body: { accountId: 999, currency: 'gold', items: [{ productId: 1, quantity: 1 }] },
    });
    await runRoute(route, ctx);
    const { status, body } = captured(ctx);
    expect(status).toBe(404);
    expect(body).toEqual({ success: false, data: null, error: 'shop.not_found' });
  });

  it('400s insufficient_stock as shop.out_of_stock', async () => {
    authedAs(['admin']);
    fakeService({
      createOrder: async () => ({ ok: false, error: 'insufficient_stock', productId: 1 }),
    });
    const route = routeFor('POST', '/admin/api/shop/orders');
    const ctx = fakeCtx({
      method: 'POST',
      url: '/admin/api/shop/orders',
      headers: { authorization: BEARER },
      body: { accountId: 7, currency: 'gold', items: [{ productId: 1, quantity: 999 }] },
    });
    await runRoute(route, ctx);
    const { status, body } = captured(ctx);
    expect(status).toBe(400);
    expect(body).toEqual({ success: false, data: null, error: 'shop.out_of_stock' });
  });

  it('400s not_tracked as shop.out_of_stock', async () => {
    authedAs(['admin']);
    fakeService({ createOrder: async () => ({ ok: false, error: 'not_tracked', productId: 1 }) });
    const route = routeFor('POST', '/admin/api/shop/orders');
    const ctx = fakeCtx({
      method: 'POST',
      url: '/admin/api/shop/orders',
      headers: { authorization: BEARER },
      body: { accountId: 7, currency: 'gold', items: [{ productId: 1, quantity: 1 }] },
    });
    await runRoute(route, ctx);
    expect(captured(ctx)).toEqual({
      status: 400,
      body: { success: false, data: null, error: 'shop.out_of_stock' },
    });
  });

  it('400s empty_items / product_not_active / price_not_set as shop.invalid_input', async () => {
    authedAs(['admin']);
    fakeService({ createOrder: async () => ({ ok: false, error: 'product_not_active' }) });
    const route = routeFor('POST', '/admin/api/shop/orders');
    const ctx = fakeCtx({
      method: 'POST',
      url: '/admin/api/shop/orders',
      headers: { authorization: BEARER },
      body: { accountId: 7, currency: 'gold', items: [{ productId: 1, quantity: 1 }] },
    });
    await runRoute(route, ctx);
    const { status, body } = captured(ctx);
    expect(status).toBe(400);
    expect(body).toEqual({ success: false, data: null, error: 'shop.invalid_input' });
  });

  it('422s an empty items array at the schema layer', async () => {
    authedAs(['admin']);
    const route = routeFor('POST', '/admin/api/shop/orders');
    const ctx = fakeCtx({
      method: 'POST',
      url: '/admin/api/shop/orders',
      headers: { authorization: BEARER },
      body: { accountId: 7, currency: 'gold', items: [] },
    });
    await runRoute(route, ctx);
    expect(captured(ctx).status).toBe(422);
  });

  it('422s a missing required field (accountId)', async () => {
    authedAs(['admin']);
    const route = routeFor('POST', '/admin/api/shop/orders');
    const ctx = fakeCtx({
      method: 'POST',
      url: '/admin/api/shop/orders',
      headers: { authorization: BEARER },
      body: { currency: 'gold', items: [{ productId: 1, quantity: 1 }] },
    });
    await runRoute(route, ctx);
    expect(captured(ctx).status).toBe(422);
  });

  it('422s a non-positive item quantity', async () => {
    authedAs(['admin']);
    const route = routeFor('POST', '/admin/api/shop/orders');
    const ctx = fakeCtx({
      method: 'POST',
      url: '/admin/api/shop/orders',
      headers: { authorization: BEARER },
      body: { accountId: 7, currency: 'gold', items: [{ productId: 1, quantity: 0 }] },
    });
    await runRoute(route, ctx);
    expect(captured(ctx).status).toBe(422);
  });
});

describe('shop orders routes: get by id', () => {
  it('gets an order by id', async () => {
    authedAs(['admin']);
    fakeService({ getOrder: async () => orderDetail() });
    const route = routeFor('GET', '/admin/api/shop/orders/:id');
    const ctx = fakeCtx({
      method: 'GET',
      url: '/admin/api/shop/orders/5',
      params: { id: '5' },
      headers: { authorization: BEARER },
    });
    await runRoute(route, ctx);
    const { status, body } = captured(ctx);
    expect(status).toBe(200);
    expect(body).toEqual({ success: true, error: null, data: orderDetail() });
  });

  it('404s a missing order', async () => {
    authedAs(['admin']);
    fakeService({ getOrder: async () => null });
    const route = routeFor('GET', '/admin/api/shop/orders/:id');
    const ctx = fakeCtx({
      method: 'GET',
      url: '/admin/api/shop/orders/999',
      params: { id: '999' },
      headers: { authorization: BEARER },
    });
    await runRoute(route, ctx);
    expect(captured(ctx).status).toBe(404);
  });
});

describe('shop orders routes: status / cancel / refund', () => {
  it('moves an order to a new status', async () => {
    authedAs(['admin']);
    let received: unknown;
    fakeService({
      updateStatus: async (id: number, status: string, adminId: number | null, note: string) => {
        received = { id, status, adminId, note };
        return { ok: true, order: orderDetail({ status: 'paid' as const }) };
      },
    });
    const route = routeFor('POST', '/admin/api/shop/orders/:id/status');
    const ctx = fakeCtx({
      method: 'POST',
      url: '/admin/api/shop/orders/5/status',
      params: { id: '5' },
      headers: { authorization: BEARER },
      body: { status: 'paid', note: 'paid via wire' },
    });
    await runRoute(route, ctx);
    const { status, body } = captured(ctx);
    expect(status).toBe(200);
    expect(body).toEqual({ success: true, error: null, data: orderDetail({ status: 'paid' }) });
    expect(received).toEqual({ id: 5, status: 'paid', adminId: 1, note: 'paid via wire' });
  });

  it('400s an invalid_transition rejection as shop.invalid_status_transition', async () => {
    authedAs(['admin']);
    fakeService({ updateStatus: async () => ({ ok: false, error: 'invalid_transition' }) });
    const route = routeFor('POST', '/admin/api/shop/orders/:id/status');
    const ctx = fakeCtx({
      method: 'POST',
      url: '/admin/api/shop/orders/5/status',
      params: { id: '5' },
      headers: { authorization: BEARER },
      body: { status: 'fulfilled' },
    });
    await runRoute(route, ctx);
    const { status, body } = captured(ctx);
    expect(status).toBe(400);
    expect(body).toEqual({ success: false, data: null, error: 'shop.invalid_status_transition' });
  });

  it('422s an invalid status enum value', async () => {
    authedAs(['admin']);
    const route = routeFor('POST', '/admin/api/shop/orders/:id/status');
    const ctx = fakeCtx({
      method: 'POST',
      url: '/admin/api/shop/orders/5/status',
      params: { id: '5' },
      headers: { authorization: BEARER },
      body: { status: 'not-a-real-status' },
    });
    await runRoute(route, ctx);
    expect(captured(ctx).status).toBe(422);
  });

  it('cancels an order', async () => {
    authedAs(['admin']);
    fakeService({
      cancelOrder: async () => ({ ok: true, order: orderDetail({ status: 'cancelled' as const }) }),
    });
    const route = routeFor('POST', '/admin/api/shop/orders/:id/cancel');
    const ctx = fakeCtx({
      method: 'POST',
      url: '/admin/api/shop/orders/5/cancel',
      params: { id: '5' },
      headers: { authorization: BEARER },
      body: { note: 'customer requested' },
    });
    await runRoute(route, ctx);
    const { status, body } = captured(ctx);
    expect(status).toBe(200);
    expect(body).toEqual({
      success: true,
      error: null,
      data: orderDetail({ status: 'cancelled' }),
    });
  });

  it('refunds an order', async () => {
    authedAs(['admin']);
    fakeService({
      refundOrder: async () => ({ ok: true, order: orderDetail({ status: 'refunded' as const }) }),
    });
    const route = routeFor('POST', '/admin/api/shop/orders/:id/refund');
    const ctx = fakeCtx({
      method: 'POST',
      url: '/admin/api/shop/orders/5/refund',
      params: { id: '5' },
      headers: { authorization: BEARER },
      body: { note: 'defective item' },
    });
    await runRoute(route, ctx);
    const { status, body } = captured(ctx);
    expect(status).toBe(200);
    expect(body).toEqual({ success: true, error: null, data: orderDetail({ status: 'refunded' }) });
  });

  it('404s a not_found rejection on cancel', async () => {
    authedAs(['admin']);
    fakeService({ cancelOrder: async () => ({ ok: false, error: 'not_found' }) });
    const route = routeFor('POST', '/admin/api/shop/orders/:id/cancel');
    const ctx = fakeCtx({
      method: 'POST',
      url: '/admin/api/shop/orders/999/cancel',
      params: { id: '999' },
      headers: { authorization: BEARER },
      body: {},
    });
    await runRoute(route, ctx);
    expect(captured(ctx).status).toBe(404);
  });
});

describe('shop orders routes: route table shape', () => {
  it('registers exactly the six routes, every one admin-surface with the admin envelope', () => {
    expect(routes.map((r) => `${r.method} ${r.path}`).sort()).toEqual(
      [
        'GET /admin/api/shop/orders',
        'POST /admin/api/shop/orders',
        'GET /admin/api/shop/orders/:id',
        'POST /admin/api/shop/orders/:id/status',
        'POST /admin/api/shop/orders/:id/cancel',
        'POST /admin/api/shop/orders/:id/refund',
      ].sort(),
    );
    for (const r of routes) {
      expect(r.surface).toBe('admin');
      expect(r.meta?.envelope).toBe('admin');
    }
  });

  it('marks every :id route operator-scoped', () => {
    const idRoutes = routes.filter((r) => r.path.includes(':id'));
    expect(idRoutes.length).toBe(4);
    for (const r of idRoutes) {
      expect(r.meta?.requireOwned).toEqual({ kind: 'shop_order', ownerScope: 'operator' });
    }
  });
});
