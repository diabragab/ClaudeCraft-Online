import { afterEach, describe, expect, it, vi } from 'vitest';
import { RealStripeCheckoutCreator } from '../../server/stripe_checkout_creator';
import {
  resetStripeSecretKeyForTests,
  setStripeSecretKeyForTests,
  stripeClient,
} from '../../server/stripe_client';

afterEach(() => {
  resetStripeSecretKeyForTests();
  vi.restoreAllMocks();
});

describe('RealStripeCheckoutCreator', () => {
  it('returns a blank/null session when Stripe is not configured', async () => {
    setStripeSecretKeyForTests(null);
    const creator = new RealStripeCheckoutCreator();
    const result = await creator.createCheckoutSession({
      packageName: 'Starter Pack',
      amountTotal: 499,
      currency: 'USD',
      successUrl: 'https://example.com/success',
      cancelUrl: 'https://example.com/cancel',
      metadata: { accountId: '7', packageId: '5' },
    });
    expect(result).toEqual({ id: '', url: null });
  });

  it('creates a one-time payment Checkout Session with the package as one line item', async () => {
    setStripeSecretKeyForTests('sk_test_a');
    const client = stripeClient();
    if (!client) throw new Error('expected a client');
    const create = vi.spyOn(client.checkout.sessions, 'create').mockResolvedValue({
      id: 'cs_test_1',
      url: 'https://checkout.stripe.com/cs_test_1',
    } as Awaited<ReturnType<typeof client.checkout.sessions.create>>);

    const creator = new RealStripeCheckoutCreator();
    const result = await creator.createCheckoutSession({
      packageName: 'Starter Pack',
      amountTotal: 499,
      currency: 'USD',
      successUrl: 'https://example.com/success',
      cancelUrl: 'https://example.com/cancel',
      metadata: { accountId: '7', packageId: '5' },
    });

    expect(result).toEqual({ id: 'cs_test_1', url: 'https://checkout.stripe.com/cs_test_1' });
    expect(create).toHaveBeenCalledWith({
      mode: 'payment',
      success_url: 'https://example.com/success',
      cancel_url: 'https://example.com/cancel',
      metadata: { accountId: '7', packageId: '5' },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: 499,
            product_data: { name: 'Starter Pack' },
          },
        },
      ],
    });
  });

  it('lowercases the currency for Stripe (which requires lowercase ISO codes)', async () => {
    setStripeSecretKeyForTests('sk_test_a');
    const client = stripeClient();
    if (!client) throw new Error('expected a client');
    const create = vi.spyOn(client.checkout.sessions, 'create').mockResolvedValue({
      id: 'cs_test_2',
      url: 'https://checkout.stripe.com/cs_test_2',
    } as Awaited<ReturnType<typeof client.checkout.sessions.create>>);

    const creator = new RealStripeCheckoutCreator();
    await creator.createCheckoutSession({
      packageName: 'Bulk Pack',
      amountTotal: 1999,
      currency: 'EUR',
      successUrl: 'https://example.com/success',
      cancelUrl: 'https://example.com/cancel',
      metadata: {},
    });

    expect(create.mock.calls[0]?.[0]?.line_items?.[0]).toMatchObject({
      price_data: { currency: 'eur' },
    });
  });

  it('returns a null url when Stripe responds without one', async () => {
    setStripeSecretKeyForTests('sk_test_a');
    const client = stripeClient();
    if (!client) throw new Error('expected a client');
    vi.spyOn(client.checkout.sessions, 'create').mockResolvedValue({
      id: 'cs_test_3',
      url: null,
    } as Awaited<ReturnType<typeof client.checkout.sessions.create>>);

    const creator = new RealStripeCheckoutCreator();
    const result = await creator.createCheckoutSession({
      packageName: 'Starter Pack',
      amountTotal: 499,
      currency: 'USD',
      successUrl: 'https://example.com/success',
      cancelUrl: 'https://example.com/cancel',
      metadata: {},
    });
    expect(result).toEqual({ id: 'cs_test_3', url: null });
  });
});
