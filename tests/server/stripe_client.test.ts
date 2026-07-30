import Stripe from 'stripe';
import { afterEach, describe, expect, it } from 'vitest';
import {
  resetStripeSecretKeyForTests,
  setStripeSecretKeyForTests,
  stripeClient,
} from '../../server/stripe_client';

afterEach(() => {
  resetStripeSecretKeyForTests();
});

describe('stripeClient', () => {
  it('returns null when no secret key is configured', () => {
    setStripeSecretKeyForTests(null);
    expect(stripeClient()).toBeNull();
  });

  it('returns a Stripe instance once a secret key is configured', () => {
    setStripeSecretKeyForTests('sk_test_a');
    const client = stripeClient();
    expect(client).toBeInstanceOf(Stripe);
  });

  it('caches and returns the SAME instance across calls with an unchanged key', () => {
    setStripeSecretKeyForTests('sk_test_a');
    const first = stripeClient();
    const second = stripeClient();
    expect(first).toBe(second);
  });

  it('builds a NEW instance when the key changes', () => {
    setStripeSecretKeyForTests('sk_test_a');
    const first = stripeClient();
    setStripeSecretKeyForTests('sk_test_b');
    const second = stripeClient();
    expect(second).not.toBe(first);
    expect(second).toBeInstanceOf(Stripe);
  });

  it('goes back to null immediately after the key is cleared', () => {
    setStripeSecretKeyForTests('sk_test_a');
    expect(stripeClient()).not.toBeNull();
    setStripeSecretKeyForTests(null);
    expect(stripeClient()).toBeNull();
  });

  it('resetStripeSecretKeyForTests restores the live env-driven read', () => {
    const saved = process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_SECRET_KEY;
    try {
      setStripeSecretKeyForTests('sk_test_a');
      expect(stripeClient()).not.toBeNull();
      resetStripeSecretKeyForTests();
      expect(stripeClient()).toBeNull();
    } finally {
      if (saved === undefined) delete process.env.STRIPE_SECRET_KEY;
      else process.env.STRIPE_SECRET_KEY = saved;
    }
  });
});
