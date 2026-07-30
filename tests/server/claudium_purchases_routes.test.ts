// Unit coverage for the Claudium Package checkout route layer
// (server/claudium_purchases_routes.ts): POST /api/shop/packages/:id/checkout.
// Mirrors shop_buy_routes.test.ts's requireAccount harness (bearer auth,
// active-scope-only) plus a faked ClaudiumPurchasesService.
process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5433/wocc_claudium_purchases_routes';

import { afterEach, describe, expect, it } from 'vitest';
import { resetAdminDbForTests, setAdminDbForTests } from '../../server/admin';
import type {
  ClaudiumPurchaseErrorCode,
  ClaudiumPurchasesService,
} from '../../server/claudium_purchases';
import {
  resetClaudiumPurchasesAuthDbForTests,
  resetClaudiumPurchasesServiceForTests,
  routes,
  setClaudiumPurchasesAuthDbForTests,
  setClaudiumPurchasesServiceForTests,
} from '../../server/claudium_purchases_routes';
import { compose } from '../../server/http/compose';
import { withErrors } from '../../server/http/middleware/with_errors';
import type { Ctx, Middleware } from '../../server/http/types';
import { fakeCtx } from './helpers';

const VALID_TOKEN = 'a'.repeat(64);
const BEARER = `Bearer ${VALID_TOKEN}`;
const CALLER_ACCOUNT_ID = 7;
const PACKAGE_ID = 5;

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
  setClaudiumPurchasesAuthDbForTests({
    accountAndScopeForToken: async () => ({ accountId: CALLER_ACCOUNT_ID, scope }),
    moderationStatusForAccount: async () => NOT_LOCKED,
  });
}

function authedAsAdmin(roles: string[] = ['admin']): void {
  setAdminDbForTests({
    accountAndScopeForToken: async () => ({ accountId: 1, scope: 'full' }),
    adminRolesForAccount: async () => ({ username: 'op', roles }),
  });
}

function fakeService(overrides: Partial<Record<keyof ClaudiumPurchasesService, unknown>>): void {
  setClaudiumPurchasesServiceForTests(overrides as unknown as ClaudiumPurchasesService);
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
  resetClaudiumPurchasesAuthDbForTests();
  resetClaudiumPurchasesServiceForTests();
  resetAdminDbForTests();
});

describe('claudium package checkout route: authorization', () => {
  it('401s without a bearer token', async () => {
    const route = routeFor('POST', '/api/shop/packages/:id/checkout');
    const ctx = fakeCtx({
      method: 'POST',
      url: `/api/shop/packages/${PACKAGE_ID}/checkout`,
      params: { id: String(PACKAGE_ID) },
    });
    await runRoute(route, ctx);
    expect(captured(ctx).status).toBe(401);
  });

  it('403s a read-scope token (mutation requires active/full)', async () => {
    authedAs('read');
    const route = routeFor('POST', '/api/shop/packages/:id/checkout');
    const ctx = fakeCtx({
      method: 'POST',
      url: `/api/shop/packages/${PACKAGE_ID}/checkout`,
      headers: { authorization: BEARER },
      params: { id: String(PACKAGE_ID) },
    });
    await runRoute(route, ctx);
    expect(captured(ctx).status).toBe(403);
  });
});

describe('claudium package checkout route: checkout', () => {
  it('starts a checkout session and returns its url', async () => {
    authedAs('full');
    let received: { accountId: number; packageId: number } | undefined;
    fakeService({
      createCheckout: async (req: {
        accountId: number;
        packageId: number;
        successUrl: string;
        cancelUrl: string;
      }) => {
        received = { accountId: req.accountId, packageId: req.packageId };
        expect(req.successUrl).toContain('/store/packages/confirmation?session_id=');
        expect(req.cancelUrl).toContain('/store/packages');
        return { ok: true, url: 'https://checkout.stripe.com/cs_test_1', sessionId: 'cs_test_1' };
      },
    });
    const route = routeFor('POST', '/api/shop/packages/:id/checkout');
    const ctx = fakeCtx({
      method: 'POST',
      url: `/api/shop/packages/${PACKAGE_ID}/checkout`,
      headers: { authorization: BEARER },
      params: { id: String(PACKAGE_ID) },
    });
    await runRoute(route, ctx);
    const { status, body } = captured(ctx);
    expect(status).toBe(200);
    expect(body).toEqual({ url: 'https://checkout.stripe.com/cs_test_1', sessionId: 'cs_test_1' });
    expect(received).toEqual({ accountId: CALLER_ACCOUNT_ID, packageId: PACKAGE_ID });
  });

  const errorCases: { error: ClaudiumPurchaseErrorCode; status: number; code: string }[] = [
    { error: 'package_not_found', status: 404, code: 'shop.package_not_found' },
    { error: 'package_disabled', status: 400, code: 'shop.package_disabled' },
    { error: 'stripe_unavailable', status: 503, code: 'shop.stripe_unavailable' },
  ];

  for (const { error, status, code } of errorCases) {
    it(`maps ${error} to ${status} ${code}`, async () => {
      authedAs('full');
      fakeService({ createCheckout: async () => ({ ok: false, error }) });
      const route = routeFor('POST', '/api/shop/packages/:id/checkout');
      const ctx = fakeCtx({
        method: 'POST',
        url: `/api/shop/packages/${PACKAGE_ID}/checkout`,
        headers: { authorization: BEARER },
        params: { id: String(PACKAGE_ID) },
      });
      await runRoute(route, ctx);
      const result = captured(ctx);
      expect(result.status).toBe(status);
      expect((result.body as { code: string }).code).toBe(code);
    });
  }

  it('422s a non-numeric :id at the schema layer', async () => {
    authedAs('full');
    const route = routeFor('POST', '/api/shop/packages/:id/checkout');
    const ctx = fakeCtx({
      method: 'POST',
      url: '/api/shop/packages/abc/checkout',
      headers: { authorization: BEARER },
      params: { id: 'abc' },
    });
    await runRoute(route, ctx);
    expect(captured(ctx).status).toBe(422);
  });
});

function purchaseRecord(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 9,
    accountId: CALLER_ACCOUNT_ID,
    accountUsername: 'playerOne',
    packageId: PACKAGE_ID,
    packageName: 'Starter Pack',
    claudiumAmount: 500,
    bonusAmount: 50,
    amountTotal: 499,
    currency: 'USD',
    status: 'paid',
    stripeSessionId: 'cs_test_1',
    stripePaymentIntentId: 'pi_test_1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('claudium package purchase status route', () => {
  it('401s without a bearer token', async () => {
    const route = routeFor('GET', '/api/shop/packages/purchases/:sessionId');
    const ctx = fakeCtx({
      method: 'GET',
      url: '/api/shop/packages/purchases/cs_test_1',
      params: { sessionId: 'cs_test_1' },
    });
    await runRoute(route, ctx);
    expect(captured(ctx).status).toBe(401);
  });

  it("returns the caller's own purchase", async () => {
    fakeService({ getPurchaseBySessionId: async () => purchaseRecord() });
    authedAs('full');
    const route = routeFor('GET', '/api/shop/packages/purchases/:sessionId');
    const ctx = fakeCtx({
      method: 'GET',
      url: '/api/shop/packages/purchases/cs_test_1',
      headers: { authorization: BEARER },
      params: { sessionId: 'cs_test_1' },
    });
    await runRoute(route, ctx);
    const { status, body } = captured(ctx);
    expect(status).toBe(200);
    expect(body).toEqual(purchaseRecord());
  });

  it('404s shop.purchase_not_found for a session with no matching purchase', async () => {
    fakeService({ getPurchaseBySessionId: async () => null });
    authedAs('full');
    const route = routeFor('GET', '/api/shop/packages/purchases/:sessionId');
    const ctx = fakeCtx({
      method: 'GET',
      url: '/api/shop/packages/purchases/cs_unknown',
      headers: { authorization: BEARER },
      params: { sessionId: 'cs_unknown' },
    });
    await runRoute(route, ctx);
    const { status, body } = captured(ctx);
    expect(status).toBe(404);
    expect((body as { code: string }).code).toBe('shop.purchase_not_found');
  });

  it("404s shop.purchase_not_found (never 403) for another account's purchase (anti-enumeration)", async () => {
    fakeService({
      getPurchaseBySessionId: async () => purchaseRecord({ accountId: CALLER_ACCOUNT_ID + 1 }),
    });
    authedAs('full');
    const route = routeFor('GET', '/api/shop/packages/purchases/:sessionId');
    const ctx = fakeCtx({
      method: 'GET',
      url: '/api/shop/packages/purchases/cs_other',
      headers: { authorization: BEARER },
      params: { sessionId: 'cs_other' },
    });
    await runRoute(route, ctx);
    const { status, body } = captured(ctx);
    expect(status).toBe(404);
    expect((body as { code: string }).code).toBe('shop.purchase_not_found');
  });
});

describe('claudium package admin purchase history route', () => {
  it('401s without a bearer token', async () => {
    const route = routeFor('GET', '/admin/api/shop/claudium/purchases');
    const ctx = fakeCtx({ method: 'GET', url: '/admin/api/shop/claudium/purchases' });
    await runRoute(route, ctx);
    expect(captured(ctx).status).toBe(401);
  });

  it('403s a viewer role (no shop.read)', async () => {
    authedAsAdmin(['viewer']);
    const route = routeFor('GET', '/admin/api/shop/claudium/purchases');
    const ctx = fakeCtx({
      method: 'GET',
      url: '/admin/api/shop/claudium/purchases',
      headers: { authorization: BEARER },
    });
    await runRoute(route, ctx);
    expect(captured(ctx).status).toBe(403);
  });

  it('lists purchases with pagination defaults', async () => {
    authedAsAdmin();
    let receivedParams: Record<string, unknown> | undefined;
    fakeService({
      listPurchases: async (params: Record<string, unknown>) => {
        receivedParams = params;
        return { rows: [purchaseRecord()], total: 1 };
      },
    });
    const route = routeFor('GET', '/admin/api/shop/claudium/purchases');
    const ctx = fakeCtx({
      method: 'GET',
      url: '/admin/api/shop/claudium/purchases',
      headers: { authorization: BEARER },
    });
    await runRoute(route, ctx);
    expect(receivedParams).toMatchObject({
      page: 1,
      limit: 20,
      sort: 'createdAt',
      dir: 'desc',
    });
  });

  it('forwards accountId and status filters', async () => {
    authedAsAdmin();
    let receivedParams: Record<string, unknown> | undefined;
    fakeService({
      listPurchases: async (params: Record<string, unknown>) => {
        receivedParams = params;
        return { rows: [], total: 0 };
      },
    });
    const route = routeFor('GET', '/admin/api/shop/claudium/purchases');
    const ctx = fakeCtx({
      method: 'GET',
      url: '/admin/api/shop/claudium/purchases',
      headers: { authorization: BEARER },
      query: { accountId: String(CALLER_ACCOUNT_ID), status: 'paid' },
    });
    await runRoute(route, ctx);
    expect(receivedParams).toMatchObject({ accountId: CALLER_ACCOUNT_ID, status: 'paid' });
  });
});

describe('claudium package checkout route: table shape', () => {
  it('registers exactly the checkout, status, and admin list routes', () => {
    expect(routes.map((r) => `${r.method} ${r.path}`)).toEqual([
      'POST /api/shop/packages/:id/checkout',
      'GET /api/shop/packages/purchases/:sessionId',
      'GET /admin/api/shop/claudium/purchases',
    ]);
    expect(routes[0]?.surface).toBe('api');
    expect(routes[1]?.surface).toBe('api');
    expect(routes[2]?.surface).toBe('admin');
  });
});
