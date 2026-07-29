import { describe, expect, it } from 'vitest';
import { stripeEnabled, stripeSecretKey, stripeWebhookSecret } from '../../server/stripe_config';

describe('stripe_config', () => {
  it('is disabled with no secret key set', () => {
    expect(stripeEnabled({})).toBe(false);
    expect(stripeSecretKey({})).toBeNull();
  });

  it('is enabled once a non-empty secret key is set', () => {
    expect(stripeEnabled({ STRIPE_SECRET_KEY: 'sk_test_abc' })).toBe(true);
    expect(stripeSecretKey({ STRIPE_SECRET_KEY: 'sk_test_abc' })).toBe('sk_test_abc');
  });

  it('treats a blank/whitespace-only secret key as unset', () => {
    expect(stripeEnabled({ STRIPE_SECRET_KEY: '   ' })).toBe(false);
    expect(stripeSecretKey({ STRIPE_SECRET_KEY: '   ' })).toBeNull();
  });

  it('reads the webhook secret independently of the api key', () => {
    expect(stripeWebhookSecret({})).toBeNull();
    expect(stripeWebhookSecret({ STRIPE_WEBHOOK_SECRET: 'whsec_abc' })).toBe('whsec_abc');
  });
});
