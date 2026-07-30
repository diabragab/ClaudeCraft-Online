// Real Stripe implementation of the StripeCheckoutCreator seam
// (server/claudium_purchases.ts). Kept as its own thin adapter so the
// purchases service never imports the Stripe SDK directly; a test injects a
// fake StripeCheckoutCreator instead of this module.

import type {
  StripeCheckoutCreator,
  StripeCheckoutSession,
  StripeCheckoutSessionParams,
} from './claudium_purchases';
import { stripeClient } from './stripe_client';

export class RealStripeCheckoutCreator implements StripeCheckoutCreator {
  async createCheckoutSession(params: StripeCheckoutSessionParams): Promise<StripeCheckoutSession> {
    const stripe = stripeClient();
    if (!stripe) return { id: '', url: null };
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
      metadata: params.metadata,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: params.currency.toLowerCase(),
            unit_amount: params.amountTotal,
            product_data: { name: params.packageName },
          },
        },
      ],
    });
    return { id: session.id, url: session.url };
  }
}
