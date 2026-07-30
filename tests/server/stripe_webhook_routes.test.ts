// Unit coverage for the Stripe webhook route layer
// (server/stripe_webhook_routes.ts): POST /api/shop/claudium/stripe/webhook.
// Drives REAL Stripe signature verification (Stripe.webhooks.constructEvent)
// rather than faking it out: the signature header is generated with the SDK's
// own generateTestHeaderString test helper, over a real (if fake-keyed)
// Stripe client, so this suite actually proves an unsigned/mis-signed
// delivery is rejected and a validly-signed one is accepted.
process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5433/wocc_stripe_webhook_routes';

import Stripe from 'stripe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ClaudiumPurchasesService } from '../../server/claudium_purchases';
import {
  resetClaudiumPurchasesServiceForTests,
  setClaudiumPurchasesServiceForTests,
} from '../../server/claudium_purchases_routes';
import { compose } from '../../server/http/compose';
import { withErrors } from '../../server/http/middleware/with_errors';
import type { Ctx, Middleware } from '../../server/http/types';
import {
  resetStripeSecretKeyForTests,
  setStripeSecretKeyForTests,
} from '../../server/stripe_client';
import { routes } from '../../server/stripe_webhook_routes';
import { fakeCtx } from './helpers';

const FAKE_SECRET_KEY = 'sk_test_fake_key_for_signing_only';
const WEBHOOK_SECRET = 'whsec_test_secret';

function signedHeader(payload: string): Promise<string> {
  return new Stripe(FAKE_SECRET_KEY).webhooks.generateTestHeaderStringAsync({
    payload,
    secret: WEBHOOK_SECRET,
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

function checkoutSessionCompletedPayload(sessionId: string, paymentIntentId: string): string {
  return JSON.stringify({
    id: 'evt_test_1',
    object: 'event',
    type: 'checkout.session.completed',
    data: {
      object: {
        id: sessionId,
        object: 'checkout.session',
        payment_intent: paymentIntentId,
      },
    },
  });
}

beforeEach(() => {
  setStripeSecretKeyForTests(FAKE_SECRET_KEY);
  process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
});

afterEach(() => {
  resetStripeSecretKeyForTests();
  delete process.env.STRIPE_WEBHOOK_SECRET;
  resetClaudiumPurchasesServiceForTests();
});

describe('stripe webhook route: signature verification', () => {
  it('503s when Stripe is not configured', async () => {
    resetStripeSecretKeyForTests();
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const route = routeFor('POST', '/api/shop/claudium/stripe/webhook');
    const payload = checkoutSessionCompletedPayload('cs_test_1', 'pi_test_1');
    const ctx = fakeCtx({
      method: 'POST',
      url: '/api/shop/claudium/stripe/webhook',
      headers: { 'stripe-signature': 'sig_irrelevant' },
      body: payload,
    });
    await runRoute(route, ctx);
    expect(captured(ctx).status).toBe(503);
  });

  it('400s a missing signature header', async () => {
    const route = routeFor('POST', '/api/shop/claudium/stripe/webhook');
    const payload = checkoutSessionCompletedPayload('cs_test_1', 'pi_test_1');
    const ctx = fakeCtx({
      method: 'POST',
      url: '/api/shop/claudium/stripe/webhook',
      body: payload,
    });
    await runRoute(route, ctx);
    const { status, body } = captured(ctx);
    expect(status).toBe(400);
    expect((body as { code: string }).code).toBe('shop.invalid_webhook_signature');
  });

  it('400s a signature that does not match the payload', async () => {
    const route = routeFor('POST', '/api/shop/claudium/stripe/webhook');
    const payload = checkoutSessionCompletedPayload('cs_test_1', 'pi_test_1');
    const wrongSignature = await signedHeader(
      checkoutSessionCompletedPayload('cs_other', 'pi_other'),
    );
    const ctx = fakeCtx({
      method: 'POST',
      url: '/api/shop/claudium/stripe/webhook',
      headers: { 'stripe-signature': wrongSignature },
      body: payload,
    });
    await runRoute(route, ctx);
    const { status, body } = captured(ctx);
    expect(status).toBe(400);
    expect((body as { code: string }).code).toBe('shop.invalid_webhook_signature');
  });

  it('accepts a validly signed payload', async () => {
    fakeService({
      markPaidFromWebhook: async () => ({
        ok: true,
        purchase: { id: 9, accountId: 1, claudiumAmount: 500, bonusAmount: 0 },
        alreadyCredited: false,
      }),
      recordWebhookEvent: async () => true,
    });
    const route = routeFor('POST', '/api/shop/claudium/stripe/webhook');
    const payload = checkoutSessionCompletedPayload('cs_test_1', 'pi_test_1');
    const ctx = fakeCtx({
      method: 'POST',
      url: '/api/shop/claudium/stripe/webhook',
      headers: { 'stripe-signature': await signedHeader(payload) },
      body: payload,
    });
    await runRoute(route, ctx);
    const { status, body } = captured(ctx);
    expect(status).toBe(200);
    expect(body).toEqual({ received: true });
  });
});

describe('stripe webhook route: event dispatch', () => {
  it('marks a checkout.session.completed purchase paid via the purchases service', async () => {
    let received: { sessionId: string; paymentIntentId: string | null } | undefined;
    fakeService({
      markPaidFromWebhook: async (sessionId: string, paymentIntentId: string | null) => {
        received = { sessionId, paymentIntentId };
        return { ok: true, purchase: { id: 9 }, alreadyCredited: false };
      },
      recordWebhookEvent: async () => true,
    });
    const route = routeFor('POST', '/api/shop/claudium/stripe/webhook');
    const payload = checkoutSessionCompletedPayload('cs_test_1', 'pi_test_1');
    const ctx = fakeCtx({
      method: 'POST',
      url: '/api/shop/claudium/stripe/webhook',
      headers: { 'stripe-signature': await signedHeader(payload) },
      body: payload,
    });
    await runRoute(route, ctx);
    expect(received).toEqual({ sessionId: 'cs_test_1', paymentIntentId: 'pi_test_1' });
  });

  it('marks a checkout.session.expired purchase expired via the purchases service', async () => {
    let receivedArgs: [string, string] | undefined;
    fakeService({
      markFailedFromWebhook: async (sessionId: string, status: string) => {
        receivedArgs = [sessionId, status];
        return { id: 9 };
      },
      recordWebhookEvent: async () => true,
    });
    const route = routeFor('POST', '/api/shop/claudium/stripe/webhook');
    const payload = JSON.stringify({
      id: 'evt_test_2',
      object: 'event',
      type: 'checkout.session.expired',
      data: { object: { id: 'cs_test_2', object: 'checkout.session' } },
    });
    const ctx = fakeCtx({
      method: 'POST',
      url: '/api/shop/claudium/stripe/webhook',
      headers: { 'stripe-signature': await signedHeader(payload) },
      body: payload,
    });
    await runRoute(route, ctx);
    expect(receivedArgs).toEqual(['cs_test_2', 'expired']);
  });

  it('records every verified delivery in the webhook audit log, including unhandled types', async () => {
    let recorded: { eventId: string; type: string; purchaseId: number | null } | undefined;
    fakeService({
      recordWebhookEvent: async (eventId: string, type: string, purchaseId: number | null) => {
        recorded = { eventId, type, purchaseId };
        return true;
      },
    });
    const route = routeFor('POST', '/api/shop/claudium/stripe/webhook');
    const payload = JSON.stringify({
      id: 'evt_test_3',
      object: 'event',
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_test_3', object: 'payment_intent' } },
    });
    const ctx = fakeCtx({
      method: 'POST',
      url: '/api/shop/claudium/stripe/webhook',
      headers: { 'stripe-signature': await signedHeader(payload) },
      body: payload,
    });
    await runRoute(route, ctx);
    expect(recorded).toEqual({
      eventId: 'evt_test_3',
      type: 'payment_intent.succeeded',
      purchaseId: null,
    });
    expect(captured(ctx).status).toBe(200);
  });
});

describe('stripe webhook route: table shape', () => {
  it('registers exactly the one route on the api surface', () => {
    expect(routes.map((r) => `${r.method} ${r.path}`)).toEqual([
      'POST /api/shop/claudium/stripe/webhook',
    ]);
    expect(routes[0]?.surface).toBe('api');
  });
});
