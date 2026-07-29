// Unit coverage for the in-game Shop's Gold checkout route
// (server/shop_storefront_gold_routes.ts): auth gating, the inline
// character-ownership check (no :id param, so no requireOwned loader), and
// the GoldCheckoutErrorCode -> HttpError mapping. The orchestration itself
// (ShopGoldCheckoutService) is unit-tested directly in
// tests/shop_gold_checkout.test.ts; this file only exercises the route
// wrapper around it. Mirrors tests/server/shop_storefront_claudium_routes.test.ts.
process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5433/wocc_storefront_gold';

import { afterEach, describe, expect, it } from 'vitest';
import { compose } from '../../server/http/compose';
import { withErrors } from '../../server/http/middleware/with_errors';
import type { Ctx, Middleware } from '../../server/http/types';
import type { GoldCheckoutResult } from '../../server/shop_gold_checkout';
import {
  resetShopGoldAuthDbForTests,
  resetShopGoldCharacterLookupForTests,
  resetShopGoldCheckoutServiceForTests,
  routes,
  setShopGoldAuthDbForTests,
  setShopGoldCharacterLookupForTests,
  setShopGoldCheckoutServiceForTests,
} from '../../server/shop_storefront_gold_routes';
import { fakeCtx } from './helpers';

const VALID_TOKEN = 'a'.repeat(64);
const BEARER = `Bearer ${VALID_TOKEN}`;
const CALLER_ACCOUNT_ID = 7;
const CHARACTER_ID = 42;

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
  setShopGoldAuthDbForTests({
    accountAndScopeForToken: async () => ({ accountId: CALLER_ACCOUNT_ID, scope }),
    moderationStatusForAccount: async () => NOT_LOCKED,
  });
}

function ownsCharacter(owns = true): void {
  setShopGoldCharacterLookupForTests({
    getCharacter: async () => (owns ? { id: CHARACTER_ID } : null),
  });
}

function fakeCheckoutResult(result: GoldCheckoutResult): void {
  setShopGoldCheckoutServiceForTests({ purchase: async () => result } as never);
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

function purchaseCtx(body: Record<string, unknown>): Ctx {
  return fakeCtx({
    method: 'POST',
    url: '/api/shop/gold/purchase',
    headers: { authorization: BEARER },
    body,
  });
}

afterEach(() => {
  resetShopGoldAuthDbForTests();
  resetShopGoldCharacterLookupForTests();
  resetShopGoldCheckoutServiceForTests();
});

describe('shop gold purchase route: authorization', () => {
  it('401s without a bearer token', async () => {
    const route = routeFor('POST', '/api/shop/gold/purchase');
    const ctx = fakeCtx({ method: 'POST', url: '/api/shop/gold/purchase', body: {} });
    await runRoute(route, ctx);
    expect(captured(ctx).status).toBe(401);
  });

  it('403s a read-scope token (mutation requires active/full)', async () => {
    authedAs('read');
    const route = routeFor('POST', '/api/shop/gold/purchase');
    const ctx = purchaseCtx({ productId: 1, characterId: CHARACTER_ID, quantity: 1 });
    await runRoute(route, ctx);
    expect(captured(ctx).status).toBe(403);
  });
});

describe('shop gold purchase route: character ownership', () => {
  it("404s with shop.character_not_found when characterId is not the caller's own", async () => {
    authedAs('full');
    ownsCharacter(false);
    const route = routeFor('POST', '/api/shop/gold/purchase');
    const ctx = purchaseCtx({ productId: 1, characterId: 999, quantity: 1 });
    await runRoute(route, ctx);
    const { status, body } = captured(ctx);
    expect(status).toBe(404);
    expect(body).toMatchObject({ code: 'shop.character_not_found' });
  });
});

describe('shop gold purchase route: success + error mapping', () => {
  it('returns the order and balance on success', async () => {
    authedAs('full');
    ownsCharacter(true);
    fakeCheckoutResult({
      ok: true,
      balance: 4_800,
      order: {
        id: 5,
        accountId: CALLER_ACCOUNT_ID,
        accountUsername: 'playerOne',
        status: 'paid',
        currency: 'gold',
        totalAmount: 20000,
        note: 'In-game Shop purchase',
        createdByAdminId: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        items: [],
        history: [],
      },
    });
    const route = routeFor('POST', '/api/shop/gold/purchase');
    const ctx = purchaseCtx({ productId: 1, characterId: CHARACTER_ID, quantity: 1 });
    await runRoute(route, ctx);
    const { status, body } = captured(ctx);
    expect(status).toBe(200);
    expect(body).toMatchObject({ balance: 4_800, order: { id: 5, status: 'paid' } });
  });

  it.each([
    ['not_found', 404, 'shop.not_found'],
    ['not_deliverable', 400, 'shop.not_deliverable'],
    ['insufficient_gold', 402, 'shop.insufficient_gold'],
    ['insufficient_stock', 400, 'shop.out_of_stock'],
  ] as const)('maps checkout error %s to %d %s', async (error, expectedStatus, expectedCode) => {
    authedAs('full');
    ownsCharacter(true);
    fakeCheckoutResult({ ok: false, error, balance: null });
    const route = routeFor('POST', '/api/shop/gold/purchase');
    const ctx = purchaseCtx({ productId: 1, characterId: CHARACTER_ID, quantity: 1 });
    await runRoute(route, ctx);
    const { status, body } = captured(ctx);
    expect(status).toBe(expectedStatus);
    expect(body).toMatchObject({ code: expectedCode });
  });
});
