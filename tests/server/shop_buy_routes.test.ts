// Unit coverage for the in-game Shop's ledger checkout route layer
// (server/shop_buy_routes.ts): POST /api/shop/buy. Mirrors
// shop_storefront_orders_routes.test.ts's requireAccount harness (bearer
// auth, active-scope-only) plus a faked ShopLedgerCheckoutService and
// character-ownership lookup.
process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5433/wocc_shop_buy_routes';

import { afterEach, describe, expect, it } from 'vitest';
import { compose } from '../../server/http/compose';
import { withErrors } from '../../server/http/middleware/with_errors';
import type { Ctx, Middleware } from '../../server/http/types';
import {
  resetShopBuyAuthDbForTests,
  resetShopBuyCharacterLookupForTests,
  resetShopBuyCheckoutServiceForTests,
  routes,
  setShopBuyAuthDbForTests,
  setShopBuyCharacterLookupForTests,
  setShopBuyCheckoutServiceForTests,
} from '../../server/shop_buy_routes';
import type {
  LedgerCheckoutErrorCode,
  ShopLedgerCheckoutService,
} from '../../server/shop_ledger_checkout';
import type { ShopOrderDetail } from '../../server/shop_orders';
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
  setShopBuyAuthDbForTests({
    accountAndScopeForToken: async () => ({ accountId: CALLER_ACCOUNT_ID, scope }),
    moderationStatusForAccount: async () => NOT_LOCKED,
  });
}

function ownsCharacter(owns = true): void {
  setShopBuyCharacterLookupForTests({
    getCharacter: async () => (owns ? { id: CHARACTER_ID } : null),
  });
}

function orderDetail(overrides: Partial<ShopOrderDetail> = {}): ShopOrderDetail {
  return {
    id: 5,
    accountId: CALLER_ACCOUNT_ID,
    accountUsername: 'playerOne',
    status: 'paid',
    currency: 'claudium',
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
        unitPrice: 200,
        quantity: 1,
        lineTotal: 200,
      },
    ],
    history: [],
    ...overrides,
  };
}

function fakeCheckout(overrides: Partial<Record<keyof ShopLedgerCheckoutService, unknown>>): void {
  setShopBuyCheckoutServiceForTests(overrides as unknown as ShopLedgerCheckoutService);
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
  resetShopBuyAuthDbForTests();
  resetShopBuyCharacterLookupForTests();
  resetShopBuyCheckoutServiceForTests();
});

describe('shop buy route: authorization', () => {
  it('401s without a bearer token', async () => {
    const route = routeFor('POST', '/api/shop/buy');
    const ctx = fakeCtx({
      method: 'POST',
      url: '/api/shop/buy',
      body: { productId: 1, characterId: CHARACTER_ID },
    });
    await runRoute(route, ctx);
    expect(captured(ctx).status).toBe(401);
  });

  it('403s a read-scope token (mutation requires active/full)', async () => {
    authedAs('read');
    const route = routeFor('POST', '/api/shop/buy');
    const ctx = fakeCtx({
      method: 'POST',
      url: '/api/shop/buy',
      headers: { authorization: BEARER },
      body: { productId: 1, characterId: CHARACTER_ID },
    });
    await runRoute(route, ctx);
    expect(captured(ctx).status).toBe(403);
  });
});

describe('shop buy route: character ownership', () => {
  it("404s shop.character_not_found for a character the caller doesn't own", async () => {
    authedAs('full');
    ownsCharacter(false);
    const route = routeFor('POST', '/api/shop/buy');
    const ctx = fakeCtx({
      method: 'POST',
      url: '/api/shop/buy',
      headers: { authorization: BEARER },
      body: { productId: 1, characterId: 999 },
    });
    await runRoute(route, ctx);
    const { status, body } = captured(ctx);
    expect(status).toBe(404);
    expect((body as { code: string }).code).toBe('shop.character_not_found');
  });
});

describe('shop buy route: purchase', () => {
  it('buys a product and returns the order plus the updated balance', async () => {
    authedAs('full');
    ownsCharacter(true);
    let received:
      | { accountId: number; characterId: number; productId: number; quantity: number }
      | undefined;
    fakeCheckout({
      purchase: async (req: typeof received) => {
        received = req;
        return { ok: true, order: orderDetail(), balance: 300 };
      },
    });
    const route = routeFor('POST', '/api/shop/buy');
    const ctx = fakeCtx({
      method: 'POST',
      url: '/api/shop/buy',
      headers: { authorization: BEARER },
      body: { productId: 1, characterId: CHARACTER_ID },
    });
    await runRoute(route, ctx);
    const { status, body } = captured(ctx);
    expect(status).toBe(200);
    expect(body).toEqual({ order: orderDetail(), balance: 300 });
    expect(received).toEqual({
      accountId: CALLER_ACCOUNT_ID,
      characterId: CHARACTER_ID,
      productId: 1,
      quantity: 1,
    });
  });

  it('defaults quantity to 1 when omitted', async () => {
    authedAs('full');
    ownsCharacter(true);
    let receivedQuantity: number | undefined;
    fakeCheckout({
      purchase: async (req: { quantity: number }) => {
        receivedQuantity = req.quantity;
        return { ok: true, order: orderDetail(), balance: 300 };
      },
    });
    const route = routeFor('POST', '/api/shop/buy');
    const ctx = fakeCtx({
      method: 'POST',
      url: '/api/shop/buy',
      headers: { authorization: BEARER },
      body: { productId: 1, characterId: CHARACTER_ID },
    });
    await runRoute(route, ctx);
    expect(receivedQuantity).toBe(1);
  });

  const errorCases: { error: LedgerCheckoutErrorCode; status: number; code: string }[] = [
    { error: 'not_found', status: 404, code: 'shop.not_found' },
    { error: 'not_deliverable', status: 400, code: 'shop.not_deliverable' },
    { error: 'insufficient_claudium', status: 402, code: 'shop.insufficient_claudium' },
    { error: 'insufficient_stock', status: 400, code: 'shop.out_of_stock' },
    { error: 'empty_items', status: 400, code: 'shop.invalid_input' },
  ];

  for (const { error, status, code } of errorCases) {
    it(`maps ${error} to ${status} ${code}`, async () => {
      authedAs('full');
      ownsCharacter(true);
      fakeCheckout({ purchase: async () => ({ ok: false, error }) });
      const route = routeFor('POST', '/api/shop/buy');
      const ctx = fakeCtx({
        method: 'POST',
        url: '/api/shop/buy',
        headers: { authorization: BEARER },
        body: { productId: 1, characterId: CHARACTER_ID },
      });
      await runRoute(route, ctx);
      const result = captured(ctx);
      expect(result.status).toBe(status);
      expect((result.body as { code: string }).code).toBe(code);
    });
  }

  it('422s a missing productId at the schema layer', async () => {
    authedAs('full');
    const route = routeFor('POST', '/api/shop/buy');
    const ctx = fakeCtx({
      method: 'POST',
      url: '/api/shop/buy',
      headers: { authorization: BEARER },
      body: { characterId: CHARACTER_ID },
    });
    await runRoute(route, ctx);
    expect(captured(ctx).status).toBe(422);
  });
});

describe('shop buy route: table shape', () => {
  it('registers exactly the one route on the api surface', () => {
    expect(routes.map((r) => `${r.method} ${r.path}`)).toEqual(['POST /api/shop/buy']);
    expect(routes[0]?.surface).toBe('api');
  });
});
