// Env gate + secret reads for the Claudium Packages Stripe integration.
// Mirrors server/steam/config.ts's shape: read LIVE per call (never a
// boot-time snapshot, so an ops toggle or a test override never fights a
// stale value), enabled only when the secret key is present, and the key
// itself is read only here, never logged, never echoed into an error body
// or client-reachable response.

/** True when Stripe purchases are live (STRIPE_SECRET_KEY set). Default off:
 *  every checkout route answers shop.stripe_unavailable and the Packages
 *  catalog still reads/lists normally, just with purchasing disabled. */
export function stripeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return stripeSecretKey(env) !== null;
}

/** The Stripe secret API key, or null when unset. Read only where a Stripe
 *  API call is about to be made; never logged, never echoed to a client. */
export function stripeSecretKey(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = (env.STRIPE_SECRET_KEY ?? '').trim();
  return raw === '' ? null : raw;
}

/** The webhook endpoint signing secret, or null when unset. Required to
 *  verify an inbound webhook's `stripe-signature` header; without it the
 *  webhook route refuses every event (fail closed, never skip verification). */
export function stripeWebhookSecret(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = (env.STRIPE_WEBHOOK_SECRET ?? '').trim();
  return raw === '' ? null : raw;
}
