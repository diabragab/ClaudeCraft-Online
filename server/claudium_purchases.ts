// Claudium Package purchases (Phase 8): business rules over
// ClaudiumPurchasesDb (server/claudium_purchases_db.ts, zero SQL here). Talks
// to Stripe only through the narrow StripeCheckoutCreator seam (real impl in
// server/stripe_checkout_creator.ts) so this service unit-tests with a fake,
// never a live Stripe call, and credits Claudium only through
// ClaudiumLedgerService.addBalance (server/claudium_ledger.ts), the one seam
// every Claudium-moving caller goes through.

import type { ClaudiumLedgerService } from './claudium_ledger';
import type { ClaudiumPackagesDb } from './claudium_packages';
import type {
  ClaudiumPurchaseListParams,
  ClaudiumPurchaseRecord,
  ClaudiumPurchasesDb,
} from './claudium_purchases_db';

export interface StripeCheckoutSessionParams {
  packageName: string;
  amountTotal: number;
  currency: string;
  successUrl: string;
  cancelUrl: string;
  metadata: Record<string, string>;
}

export interface StripeCheckoutSession {
  id: string;
  url: string | null;
}

/** The narrow seam this service needs from Stripe: create one Checkout
 *  Session. Kept separate from server/stripe_client.ts's full SDK singleton
 *  so tests inject a fake instead of touching the network. */
export interface StripeCheckoutCreator {
  createCheckoutSession(params: StripeCheckoutSessionParams): Promise<StripeCheckoutSession>;
}

export type ClaudiumPurchaseErrorCode =
  | 'package_not_found'
  | 'package_disabled'
  | 'stripe_unavailable'
  | 'purchase_not_found';

export interface CreateCheckoutRequest {
  accountId: number;
  packageId: number;
  successUrl: string;
  cancelUrl: string;
}

export type CreateCheckoutResult =
  | { ok: true; url: string; sessionId: string }
  | { ok: false; error: ClaudiumPurchaseErrorCode };

export interface MarkPaidResult {
  ok: boolean;
  purchase: ClaudiumPurchaseRecord | null;
  alreadyCredited: boolean;
}

export class ClaudiumPurchasesService {
  constructor(
    private readonly packages: Pick<ClaudiumPackagesDb, 'getPackage'>,
    private readonly ledger: ClaudiumLedgerService,
    private readonly db: ClaudiumPurchasesDb,
    private readonly stripe: StripeCheckoutCreator,
  ) {}

  async createCheckout(req: CreateCheckoutRequest): Promise<CreateCheckoutResult> {
    const pkg = await this.packages.getPackage(req.packageId);
    if (!pkg) return { ok: false, error: 'package_not_found' };
    if (!pkg.enabled) return { ok: false, error: 'package_disabled' };

    const session = await this.stripe.createCheckoutSession({
      packageName: pkg.name,
      amountTotal: pkg.price,
      currency: pkg.currency,
      successUrl: req.successUrl,
      cancelUrl: req.cancelUrl,
      metadata: {
        accountId: String(req.accountId),
        packageId: String(pkg.id),
      },
    });
    if (!session.url) return { ok: false, error: 'stripe_unavailable' };

    await this.db.insertPurchase({
      accountId: req.accountId,
      packageId: pkg.id,
      packageName: pkg.name,
      claudiumAmount: pkg.claudiumAmount,
      bonusAmount: pkg.bonusAmount,
      amountTotal: pkg.price,
      currency: pkg.currency,
      stripeSessionId: session.id,
    });
    return { ok: true, url: session.url, sessionId: session.id };
  }

  getPurchaseBySessionId(sessionId: string): Promise<ClaudiumPurchaseRecord | null> {
    return this.db.getPurchaseBySessionId(sessionId);
  }

  listPurchases(
    params: ClaudiumPurchaseListParams,
  ): Promise<{ rows: ClaudiumPurchaseRecord[]; total: number }> {
    return this.db.listPurchases(params);
  }

  /** Called from the Stripe webhook once `checkout.session.completed` (or
   *  `checkout.session.async_payment_succeeded`) is verified. Credits the
   *  ledger AT MOST ONCE per purchase: `markPurchasePaid` is a conditional
   *  `UPDATE ... WHERE status = 'pending'`, so a concurrent or replayed
   *  delivery for the SAME session loses the race and this method returns
   *  alreadyCredited:true without touching the ledger a second time. The
   *  transition is claimed BEFORE crediting on purpose: if the ledger call
   *  then fails, the purchase is left 'paid' without having been credited,
   *  a rare, auditable, admin-recoverable state (via the existing ledger
   *  ADMIN_ADD adjustment route) that is strictly safer than the reverse
   *  order, which could double-credit under a race. */
  async markPaidFromWebhook(
    sessionId: string,
    paymentIntentId: string | null,
  ): Promise<MarkPaidResult> {
    const claimed = await this.db.markPurchasePaid(sessionId, paymentIntentId);
    if (!claimed) {
      const existing = await this.db.getPurchaseBySessionId(sessionId);
      return { ok: existing !== null, purchase: existing, alreadyCredited: true };
    }
    const total = claimed.claudiumAmount + claimed.bonusAmount;
    await this.ledger.addBalance(
      claimed.accountId,
      total,
      'PURCHASE',
      `stripe-session-${sessionId}`,
    );
    return { ok: true, purchase: claimed, alreadyCredited: false };
  }

  /** checkout.session.expired or a failed async payment: only ever moves a
   *  still-pending purchase to a terminal state, so a late/out-of-order
   *  failure event can never undo an already-paid sale. */
  async markFailedFromWebhook(
    sessionId: string,
    status: 'failed' | 'expired',
  ): Promise<ClaudiumPurchaseRecord | null> {
    return this.db.markPurchaseTerminal(sessionId, status);
  }

  /** Best-effort audit log of every webhook delivery received; returns false
   *  when this Stripe event id was already recorded (a retry). */
  recordWebhookEvent(eventId: string, type: string, purchaseId: number | null): Promise<boolean> {
    return this.db.recordWebhookEvent(eventId, type, purchaseId);
  }
}
