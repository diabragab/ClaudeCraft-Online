// Unit coverage for the Claudium ledger route layer
// (server/claudium_ledger_routes.ts): the player-facing balance/history reads
// (requireAccount scope 'read', mirrors shop_storefront_orders_routes.test.ts's
// harness) and the admin ADMIN_ADD/ADMIN_REMOVE adjust route (requireAdmin +
// requireAdminTarget, mirrors shop_products_routes.test.ts's harness).
process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5433/wocc_claudium_ledger_routes';

import { afterEach, describe, expect, it } from 'vitest';

import { resetAdminDbForTests, setAdminDbForTests } from '../../server/admin';
import type { ClaudiumHistoryEntry } from '../../server/claudium_ledger_db';
import {
  resetClaudiumLedgerAuthDbForTests,
  resetClaudiumLedgerServiceForTests,
  routes,
  setClaudiumLedgerAuthDbForTests,
  setClaudiumLedgerServiceForTests,
} from '../../server/claudium_ledger_routes';
import { compose } from '../../server/http/compose';
import { withErrors } from '../../server/http/middleware/with_errors';
import type { Ctx, Middleware } from '../../server/http/types';
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

function authedAsPlayer(scope: 'read' | 'full' = 'read'): void {
  setClaudiumLedgerAuthDbForTests({
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
  resetClaudiumLedgerAuthDbForTests();
  resetClaudiumLedgerServiceForTests();
  resetAdminDbForTests();
});

describe('claudium ledger routes: balance', () => {
  it('401s without a bearer token', async () => {
    const route = routeFor('GET', '/api/shop/claudium/balance');
    const ctx = fakeCtx({ method: 'GET', url: '/api/shop/claudium/balance' });
    await runRoute(route, ctx);
    expect(captured(ctx).status).toBe(401);
  });

  it("returns the caller's own balance", async () => {
    authedAsPlayer('read');
    setClaudiumLedgerServiceForTests({
      getBalance: async (accountId: number) => (accountId === CALLER_ACCOUNT_ID ? 750 : -1),
    } as never);
    const route = routeFor('GET', '/api/shop/claudium/balance');
    const ctx = fakeCtx({
      method: 'GET',
      url: '/api/shop/claudium/balance',
      headers: { authorization: BEARER },
    });
    await runRoute(route, ctx);
    const { status, body } = captured(ctx);
    expect(status).toBe(200);
    expect(body).toEqual({ balance: 750 });
  });
});

describe('claudium ledger routes: history', () => {
  it("returns the caller's own history, newest first", async () => {
    authedAsPlayer('read');
    const entries: ClaudiumHistoryEntry[] = [
      {
        id: 2,
        accountId: CALLER_ACCOUNT_ID,
        amount: -200,
        type: 'PURCHASE',
        reason: 'shop-order-1',
        createdAt: '2026-01-02T00:00:00.000Z',
      },
    ];
    let receivedAccountId: number | undefined;
    let receivedLimit: number | undefined;
    setClaudiumLedgerServiceForTests({
      getHistory: async (accountId: number, limit: number) => {
        receivedAccountId = accountId;
        receivedLimit = limit;
        return entries;
      },
    } as never);
    const route = routeFor('GET', '/api/shop/claudium/history');
    const ctx = fakeCtx({
      method: 'GET',
      url: '/api/shop/claudium/history',
      headers: { authorization: BEARER },
    });
    await runRoute(route, ctx);
    const { status, body } = captured(ctx);
    expect(status).toBe(200);
    expect(body).toEqual({ entries });
    expect(receivedAccountId).toBe(CALLER_ACCOUNT_ID);
    expect(receivedLimit).toBe(100);
  });

  it('respects an explicit limit query param', async () => {
    authedAsPlayer('read');
    let receivedLimit: number | undefined;
    setClaudiumLedgerServiceForTests({
      getHistory: async (_accountId: number, limit: number) => {
        receivedLimit = limit;
        return [];
      },
    } as never);
    const route = routeFor('GET', '/api/shop/claudium/history');
    const ctx = fakeCtx({
      method: 'GET',
      url: '/api/shop/claudium/history?limit=5',
      query: { limit: '5' },
      headers: { authorization: BEARER },
    });
    await runRoute(route, ctx);
    expect(receivedLimit).toBe(5);
  });
});

describe('claudium ledger routes: admin adjust', () => {
  it('401s without an admin bearer token', async () => {
    const route = routeFor('POST', '/admin/api/claudium/accounts/:id/adjust');
    const ctx = fakeCtx({
      method: 'POST',
      url: '/admin/api/claudium/accounts/5/adjust',
      params: { id: '5' },
      body: { amount: 100 },
    });
    await runRoute(route, ctx);
    expect(captured(ctx).status).toBe(401);
  });

  it('grants Claudium for a positive amount (ADMIN_ADD)', async () => {
    authedAsAdmin();
    let received: { accountId: number; amount: number; type: string; reason: string } | undefined;
    setClaudiumLedgerServiceForTests({
      addBalance: async (accountId: number, amount: number, type: string, reason: string) => {
        received = { accountId, amount, type, reason };
        return 600;
      },
    } as never);
    const route = routeFor('POST', '/admin/api/claudium/accounts/:id/adjust');
    const ctx = fakeCtx({
      method: 'POST',
      url: '/admin/api/claudium/accounts/5/adjust',
      params: { id: '5' },
      headers: { authorization: BEARER },
      body: { amount: 500, reason: 'support case' },
    });
    await runRoute(route, ctx);
    const { status, body } = captured(ctx);
    expect(status).toBe(200);
    expect(body).toEqual({ success: true, error: null, data: { balance: 600 } });
    expect(received).toEqual({
      accountId: 5,
      amount: 500,
      type: 'ADMIN_ADD',
      reason: 'support case',
    });
  });

  it('deducts Claudium for a negative amount (ADMIN_REMOVE)', async () => {
    authedAsAdmin();
    let received: { accountId: number; amount: number; type: string; reason: string } | undefined;
    setClaudiumLedgerServiceForTests({
      removeBalance: async (accountId: number, amount: number, type: string, reason: string) => {
        received = { accountId, amount, type, reason };
        return { ok: true, balance: 100 };
      },
    } as never);
    const route = routeFor('POST', '/admin/api/claudium/accounts/:id/adjust');
    const ctx = fakeCtx({
      method: 'POST',
      url: '/admin/api/claudium/accounts/5/adjust',
      params: { id: '5' },
      headers: { authorization: BEARER },
      body: { amount: -200, reason: 'correction' },
    });
    await runRoute(route, ctx);
    const { status, body } = captured(ctx);
    expect(status).toBe(200);
    expect(body).toEqual({ success: true, error: null, data: { balance: 100 } });
    expect(received).toEqual({
      accountId: 5,
      amount: 200,
      type: 'ADMIN_REMOVE',
      reason: 'correction',
    });
  });

  it('409s an ADMIN_REMOVE that would take the balance negative', async () => {
    authedAsAdmin();
    setClaudiumLedgerServiceForTests({
      removeBalance: async () => ({ ok: false, balance: null }),
    } as never);
    const route = routeFor('POST', '/admin/api/claudium/accounts/:id/adjust');
    const ctx = fakeCtx({
      method: 'POST',
      url: '/admin/api/claudium/accounts/5/adjust',
      params: { id: '5' },
      headers: { authorization: BEARER },
      body: { amount: -999999 },
    });
    await runRoute(route, ctx);
    const { status, body } = captured(ctx);
    expect(status).toBe(409);
    expect((body as { error: string }).error).toBe('shop.insufficient_claudium');
  });

  it('400s a zero amount', async () => {
    authedAsAdmin();
    const route = routeFor('POST', '/admin/api/claudium/accounts/:id/adjust');
    const ctx = fakeCtx({
      method: 'POST',
      url: '/admin/api/claudium/accounts/5/adjust',
      params: { id: '5' },
      headers: { authorization: BEARER },
      body: { amount: 0 },
    });
    await runRoute(route, ctx);
    const { status, body } = captured(ctx);
    expect(status).toBe(400);
    expect((body as { error: string }).error).toBe('shop.invalid_input');
  });

  it("404s a non-numeric target account id before any service call (the central admin permission gate's route regex requires \\d+, same as every other admin :id route)", async () => {
    authedAsAdmin();
    let called = false;
    setClaudiumLedgerServiceForTests({
      addBalance: async () => {
        called = true;
        return 0;
      },
    } as never);
    const route = routeFor('POST', '/admin/api/claudium/accounts/:id/adjust');
    const ctx = fakeCtx({
      method: 'POST',
      url: '/admin/api/claudium/accounts/not-a-number/adjust',
      params: { id: 'not-a-number' },
      headers: { authorization: BEARER },
      body: { amount: 100 },
    });
    await runRoute(route, ctx);
    expect(captured(ctx).status).toBe(404);
    expect(called).toBe(false);
  });
});

describe('claudium ledger routes: route table shape', () => {
  it('registers exactly the three routes', () => {
    expect(routes.map((r) => `${r.method} ${r.path}`).sort()).toEqual(
      [
        'GET /api/shop/claudium/balance',
        'GET /api/shop/claudium/history',
        'POST /admin/api/claudium/accounts/:id/adjust',
      ].sort(),
    );
  });

  it('marks the admin adjust route operator-scoped', () => {
    const adjustRoute = routeFor('POST', '/admin/api/claudium/accounts/:id/adjust');
    expect(adjustRoute.meta?.requireOwned).toEqual({
      kind: 'claudium_account',
      ownerScope: 'operator',
    });
    expect(adjustRoute.surface).toBe('admin');
  });
});
