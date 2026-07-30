// The one place server code constructs the real Stripe SDK client. Lazy
// singleton over the live secret key (stripe_config.ts): built on first use,
// rebuilt if the key changes (so a test override via setStripeSecretKeyForTests
// takes effect without a process restart), never constructed when the key is
// absent. Every Checkout Session / webhook-verification call in this repo
// goes through stripeClient(), never `new Stripe(...)` inline elsewhere.

import Stripe from 'stripe';
import { stripeSecretKey } from './stripe_config';

let cachedClient: Stripe | null = null;
let cachedKey: string | null = null;
let keyOverride: string | undefined;

/** The live Stripe client, or null when STRIPE_SECRET_KEY is unset. */
export function stripeClient(): Stripe | null {
  const key = keyOverride !== undefined ? keyOverride : stripeSecretKey();
  if (key === null) return null;
  if (cachedClient && cachedKey === key) return cachedClient;
  cachedClient = new Stripe(key);
  cachedKey = key;
  return cachedClient;
}

/** Override the secret key read (test-only): pass a fake key, or null to
 *  simulate "unset" regardless of the real environment. */
export function setStripeSecretKeyForTests(key: string | null): void {
  keyOverride = key ?? undefined;
  cachedClient = null;
  cachedKey = null;
}

/** Restore the real env-driven secret key read (test-only). */
export function resetStripeSecretKeyForTests(): void {
  keyOverride = undefined;
  cachedClient = null;
  cachedKey = null;
}
