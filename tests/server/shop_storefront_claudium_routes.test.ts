// Unit coverage for the in-game Shop's Claudium checkout route
// (server/shop_storefront_claudium_routes.ts): auth gating, the inline
// character-ownership check (no :id param, so no requireOwned loader), and
// the ClaudiumCheckoutErrorCode -> HttpError mapping. The orchestration
// itself (ShopClaudiumCheckoutService) is unit-tested directly in
// tests/shop_claudium_checkout.test.ts; this file only exercises the route
// wrapper around it.
process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5433/wocc_storefront_claudium';

import { afterEach, describe, expect, it } from 'vitest';
import { compose } from '../../server/http/compose';
import { withErrors } from '../../server/http/middleware/with_errors';
import type { Ctx, Middleware } from '../../server/http/types';
import type { ClaudiumCheckoutResult } from '../../server/shop_claudium_checkout';
import {
  resetShopClaudiumAuthDbForTests,
  resetShopClaudiumCharacterLookupForTests,
  resetShopClaudiumCheckoutServiceForTests,
  routes,
  setShopClaudiumAuthDbForTests,
  setShopClaudiumCharacterLookupForTests,
  setShopClaudiumCheckoutServiceForTests,
} from '../../server/shop_storefront_claudium_routes';
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
  setShopClaudiumAuthDbForTests({
    accountAndScopeForToken: async () => ({ accountId: CALLER_ACCOUNT_ID, scope }),
    moderationStatusForAccount: async () => NOT_LOCKED,
  });
}

function ownsCharacter(owns = true): void {
  setShopClaudiumCharacterLookupForTests({
    getCharacter: async () => (owns ? { id: CHARACTER_ID } : null),
  });
}

function fakeCheckoutResult(result: ClaudiumCheckoutResult): void {
  setShopClaudiumCheckoutServiceForTests({ purchase: async () => result } as never);
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
    url: '/api/shop/claudium/purchase',
    headers: { authorization: BEARER },
    body,
  });
}

afterEach(() => {
  resetShopClaudiumAuthDbForTests();
  resetShopClaudiumCharacterLookupForTests();
  resetShopClaudiumCheckoutServiceForTests();
});

describe('shop claudium purchase route: authorization', () => {
  it('401s without a bearer token', async () => {
    const route = routeFor('POST', '/api/shop/claudium/purchase');
    const ctx = fakeCtx({ method: 'POST', url: '/api/shop/claudium/purchase', body: {} });
    await runRoute(route, ctx);
    expect(captured(ctx).status).toBe(401);
  });

  it('403s a read-scope token (mutation requires active/full)', async () => {
    authedAs('read');
    const route = routeFor('POST', '/api/shop/claudium/purchase');
    const ctx = purchaseCtx({ productId: 1, characterId: CHARACTER_ID, quantity: 1 });
    await runRoute(route, ctx);
    expect(captured(ctx).status).toBe(403);
  });
});

describe('shop claudium purchase route: character ownership', () => {
  it("404s with shop.character_not_found when characterId is not the caller's own", async () => {
    authedAs('full');
    ownsCharacter(false);
    const route = routeFor('POST', '/api/shop/claudium/purchase');
    const ctx = purchaseCtx({ productId: 1, characterId: 999, quantity: 1 });
    await runRoute(route, ctx);
    const { status, body } = captured(ctx);
    expect(status).toBe(404);
    expect(body).toMatchObject({ code: 'shop.character_not_found' });
  });
});

describe('shop claudium purchase route: success + error mapping', () => {
  it('returns the order and balance on success', async () => {
    authedAs('full');
    ownsCharacter(true);
    fakeCheckoutResult({
      ok: true,
      balance: 800,
      order: {
        id: 5,
        accountId: CALLER_ACCOUNT_ID,
        accountUsername: 'playerOne',
        status: 'paid',
        currency: 'claudium',
        totalAmount: 200,
        note: 'In-game Shop purchase',
        createdByAdminId: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        items: [],
        history: [],
      },
    });
    const route = routeFor('POST', '/api/shop/claudium/purchase');
    const ctx = purchaseCtx({ productId: 1, characterId: CHARACTER_ID, quantity: 1 });
    await runRoute(route, ctx);
    const { status, body } = captured(ctx);
    expect(status).toBe(200);
    expect(body).toMatchObject({ balance: 800, order: { id: 5, status: 'paid' } });
  });

  it.each([
    ['not_found', 404, 'shop.not_found'],
    ['not_deliverable', 400, 'shop.not_deliverable'],
    ['insufficient_balance', 402, 'shop.insufficient_claudium'],
    ['price_changed', 409, 'shop.price_changed'],
    ['spend_unavailable', 503, 'shop.claudium_unavailable'],
    ['insufficient_stock', 400, 'shop.out_of_stock'],
  ] as const)('maps checkout error %s to %d %s', async (error, expectedStatus, expectedCode) => {
    authedAs('full');
    ownsCharacter(true);
    fakeCheckoutResult({ ok: false, error, balance: null, costClaudium: null });
    const route = routeFor('POST', '/api/shop/claudium/purchase');
    const ctx = purchaseCtx({ productId: 1, characterId: CHARACTER_ID, quantity: 1 });
    await runRoute(route, ctx);
    const { status, body } = captured(ctx);
    expect(status).toBe(expectedStatus);
    expect(body).toMatchObject({ code: expectedCode });
  });
});
