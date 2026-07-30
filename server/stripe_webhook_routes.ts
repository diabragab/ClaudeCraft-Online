// Stripe webhook delivery (Phase 8): POST /api/shop/claudium/stripe/webhook,
// verified and dispatched into ClaudiumPurchasesService. A DIFFERENT prefix
// owner than the legacy /api/claudium/stripe/webhook (server/claudium.ts's
// external-economy pass-through), so the two never collide on a path.
//
// Raw-body pattern (mirrors server/claudium.ts's handleClaudiumStripeWebhook):
// no `withBody()` on the RouteDef, readBinaryBody(req, maxBytes) directly in
// the handler, so the exact bytes Stripe signed are what gets verified.
// Signature verification (stripe.webhooks.constructEvent) is the only trust
// boundary here: nothing in this file believes a session id or amount that
// did not pass it.

import type Stripe from 'stripe';
import { claudiumPurchasesServiceInstance } from './claudium_purchases_routes';
import { HttpError } from './http/errors';
import type { Ctx, RouteDef } from './http/types';
import { json, readBinaryBody } from './http_util';
import { stripeClient } from './stripe_client';
import { stripeWebhookSecret } from './stripe_config';

const STRIPE_WEBHOOK_MAX_BYTES = 1024 * 1024;

/**
 * Resolve the checkout.session payload's PaymentIntent id, which Stripe may
 * send either as a bare string or an expanded PaymentIntent object depending
 * on the account's expansion settings.
 */
function paymentIntentIdOf(session: Stripe.Checkout.Session): string | null {
  const pi = session.payment_intent;
  if (typeof pi === 'string') return pi;
  return pi?.id ?? null;
}

/** Dispatches one verified event into the purchases service; returns the
 *  affected purchase's id (for the audit log), or null for an event type
 *  this route does not act on. */
async function applyEvent(event: Stripe.Event): Promise<number | null> {
  const service = claudiumPurchasesServiceInstance();
  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded': {
      const session = event.data.object as Stripe.Checkout.Session;
      const result = await service.markPaidFromWebhook(session.id, paymentIntentIdOf(session));
      return result.purchase?.id ?? null;
    }
    case 'checkout.session.expired': {
      const session = event.data.object as Stripe.Checkout.Session;
      const purchase = await service.markFailedFromWebhook(session.id, 'expired');
      return purchase?.id ?? null;
    }
    case 'checkout.session.async_payment_failed': {
      const session = event.data.object as Stripe.Checkout.Session;
      const purchase = await service.markFailedFromWebhook(session.id, 'failed');
      return purchase?.id ?? null;
    }
    default:
      return null;
  }
}

/** POST /api/shop/claudium/stripe/webhook: verify the Stripe signature, then
 *  credit/terminate the matching purchase. Every verified delivery (handled
 *  type or not) is recorded in the webhook audit log. */
async function webhookHandler(ctx: Ctx): Promise<void> {
  const stripe = stripeClient();
  const secret = stripeWebhookSecret();
  if (!stripe || !secret) throw new HttpError(503, 'shop.stripe_unavailable');

  const signature = String(ctx.req.headers['stripe-signature'] ?? '');
  const rawBody = await readBinaryBody(ctx.req, STRIPE_WEBHOOK_MAX_BYTES);

  let event: Stripe.Event;
  try {
    // Async, not the sync constructEvent: the sync path requires Node's
    // crypto provider specifically and throws when the SDK's runtime
    // detection instead selects the Web Crypto (SubtleCrypto) provider,
    // which is async-only. constructEventAsync works under either provider.
    event = await stripe.webhooks.constructEventAsync(rawBody, signature, secret);
  } catch {
    throw new HttpError(400, 'shop.invalid_webhook_signature');
  }

  const purchaseId = await applyEvent(event);
  await claudiumPurchasesServiceInstance().recordWebhookEvent(event.id, event.type, purchaseId);
  json(ctx.res, 200, { received: true });
}

// ---------------------------------------------------------------------------
// The route table. registry.ts spreads this into apiRoutes. Registry-only:
// no legacy ladder twin (a brand-new surface, distinct prefix from
// server/claudium.ts's own webhook route).
// ---------------------------------------------------------------------------

export const routes: RouteDef[] = [
  {
    method: 'POST',
    path: '/api/shop/claudium/stripe/webhook',
    surface: 'api',
    // No auth: Stripe itself is the caller, authenticated by the signature
    // check inside the handler, not a bearer token. No :param, so this needs
    // no requireOwned/publicRead marker.
    handler: webhookHandler,
  },
];
