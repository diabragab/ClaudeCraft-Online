import { beforeEach, describe, expect, it } from 'vitest';
import { ClaudiumLedgerService } from '../server/claudium_ledger';
import type {
  ClaudiumDebitResult,
  ClaudiumHistoryEntry,
  ClaudiumLedgerDb,
  ClaudiumTransactionType,
} from '../server/claudium_ledger_db';
import type { ClaudiumPackageRecord, ClaudiumPackagesDb } from '../server/claudium_packages';
import type { StripeCheckoutCreator, StripeCheckoutSession } from '../server/claudium_purchases';
import { ClaudiumPurchasesService } from '../server/claudium_purchases';
import type {
  ClaudiumPurchaseListParams,
  ClaudiumPurchaseRecord,
  ClaudiumPurchaseStatus,
  ClaudiumPurchasesDb,
  ClaudiumPurchaseWriteRow,
} from '../server/claudium_purchases_db';

// In-memory fakes mirroring the Pg*Db contracts (server/CLAUDE.md: "Endpoint
// tests: FakeDb, not a pg-mock").
class FakeClaudiumLedgerDb implements ClaudiumLedgerDb {
  balances = new Map<number, number>();
  history: ClaudiumHistoryEntry[] = [];
  private nextHistoryId = 1;

  async getBalance(accountId: number): Promise<number> {
    return this.balances.get(accountId) ?? 0;
  }

  async addBalance(
    accountId: number,
    amount: number,
    type: ClaudiumTransactionType,
    reason: string,
  ): Promise<number> {
    const balance = (this.balances.get(accountId) ?? 0) + amount;
    this.balances.set(accountId, balance);
    this.history.push({
      id: this.nextHistoryId++,
      accountId,
      amount,
      type,
      reason,
      createdAt: new Date(0).toISOString(),
    });
    return balance;
  }

  async removeBalance(
    accountId: number,
    amount: number,
    type: ClaudiumTransactionType,
    reason: string,
  ): Promise<ClaudiumDebitResult> {
    const current = this.balances.get(accountId) ?? 0;
    if (current < amount) return { ok: false, error: 'insufficient_balance' };
    const balance = current - amount;
    this.balances.set(accountId, balance);
    this.history.push({
      id: this.nextHistoryId++,
      accountId,
      amount: -amount,
      type,
      reason,
      createdAt: new Date(0).toISOString(),
    });
    return { ok: true, balance };
  }

  async getHistory(accountId: number, limit: number): Promise<ClaudiumHistoryEntry[]> {
    return this.history.filter((h) => h.accountId === accountId).slice(0, limit);
  }
}

class FakeClaudiumPackagesDb implements Pick<ClaudiumPackagesDb, 'getPackage'> {
  packages = new Map<number, ClaudiumPackageRecord>();

  async getPackage(id: number): Promise<ClaudiumPackageRecord | null> {
    return this.packages.get(id) ?? null;
  }
}

class FakeClaudiumPurchasesDb implements ClaudiumPurchasesDb {
  rows: ClaudiumPurchaseRecord[] = [];
  events: { id: string; type: string; purchaseId: number | null }[] = [];
  private nextId = 1;

  async insertPurchase(row: ClaudiumPurchaseWriteRow): Promise<ClaudiumPurchaseRecord> {
    const record: ClaudiumPurchaseRecord = {
      id: this.nextId++,
      accountId: row.accountId,
      accountUsername: `user${row.accountId}`,
      packageId: row.packageId,
      packageName: row.packageName,
      claudiumAmount: row.claudiumAmount,
      bonusAmount: row.bonusAmount,
      amountTotal: row.amountTotal,
      currency: row.currency,
      status: 'pending',
      stripeSessionId: row.stripeSessionId,
      stripePaymentIntentId: null,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    };
    this.rows.push(record);
    return record;
  }

  async getPurchaseBySessionId(sessionId: string): Promise<ClaudiumPurchaseRecord | null> {
    return this.rows.find((r) => r.stripeSessionId === sessionId) ?? null;
  }

  async listPurchases(
    params: ClaudiumPurchaseListParams,
  ): Promise<{ rows: ClaudiumPurchaseRecord[]; total: number }> {
    let filtered = this.rows.slice();
    if (params.accountId !== undefined) {
      filtered = filtered.filter((r) => r.accountId === params.accountId);
    }
    if (params.status !== undefined) {
      filtered = filtered.filter((r) => r.status === params.status);
    }
    const total = filtered.length;
    const offset = (params.page - 1) * params.limit;
    return { rows: filtered.slice(offset, offset + params.limit), total };
  }

  async markPurchasePaid(
    sessionId: string,
    paymentIntentId: string | null,
  ): Promise<ClaudiumPurchaseRecord | null> {
    const row = this.rows.find((r) => r.stripeSessionId === sessionId);
    if (!row || row.status !== 'pending') return null;
    row.status = 'paid';
    row.stripePaymentIntentId = paymentIntentId;
    row.updatedAt = new Date(1).toISOString();
    return row;
  }

  async markPurchaseTerminal(
    sessionId: string,
    status: 'failed' | 'expired',
  ): Promise<ClaudiumPurchaseRecord | null> {
    const row = this.rows.find((r) => r.stripeSessionId === sessionId);
    if (!row || row.status !== 'pending') return null;
    row.status = status as ClaudiumPurchaseStatus;
    row.updatedAt = new Date(1).toISOString();
    return row;
  }

  async recordWebhookEvent(
    eventId: string,
    type: string,
    purchaseId: number | null,
  ): Promise<boolean> {
    if (this.events.some((e) => e.id === eventId)) return false;
    this.events.push({ id: eventId, type, purchaseId });
    return true;
  }
}

class FakeStripeCheckoutCreator implements StripeCheckoutCreator {
  nextSessionId = 'cs_test_1';
  unavailable = false;
  received: unknown;

  async createCheckoutSession(params: unknown): Promise<StripeCheckoutSession> {
    this.received = params;
    if (this.unavailable) return { id: '', url: null };
    return { id: this.nextSessionId, url: `https://checkout.stripe.com/${this.nextSessionId}` };
  }
}

const PACKAGE: ClaudiumPackageRecord = {
  id: 5,
  name: 'Starter Pack',
  claudiumAmount: 500,
  bonusAmount: 50,
  price: 499,
  currency: 'USD',
  stripePriceId: null,
  enabled: true,
  displayOrder: 0,
  imageUrl: null,
  discountPercent: 0,
  featured: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function harness() {
  const packagesDb = new FakeClaudiumPackagesDb();
  packagesDb.packages.set(PACKAGE.id, { ...PACKAGE });
  const ledgerDb = new FakeClaudiumLedgerDb();
  const ledger = new ClaudiumLedgerService(ledgerDb);
  const purchasesDb = new FakeClaudiumPurchasesDb();
  const stripe = new FakeStripeCheckoutCreator();
  const svc = new ClaudiumPurchasesService(packagesDb, ledger, purchasesDb, stripe);
  return { packagesDb, ledgerDb, ledger, purchasesDb, stripe, svc };
}

describe('ClaudiumPurchasesService.createCheckout', () => {
  let ctx: ReturnType<typeof harness>;

  beforeEach(() => {
    ctx = harness();
  });

  it('creates a Stripe session and a pending purchase row', async () => {
    const result = await ctx.svc.createCheckout({
      accountId: 7,
      packageId: PACKAGE.id,
      successUrl: 'https://example.com/success',
      cancelUrl: 'https://example.com/cancel',
    });
    expect(result).toEqual({
      ok: true,
      url: 'https://checkout.stripe.com/cs_test_1',
      sessionId: 'cs_test_1',
    });
    expect(ctx.purchasesDb.rows).toHaveLength(1);
    expect(ctx.purchasesDb.rows[0]).toMatchObject({
      accountId: 7,
      packageId: PACKAGE.id,
      claudiumAmount: 500,
      bonusAmount: 50,
      amountTotal: 499,
      currency: 'USD',
      status: 'pending',
      stripeSessionId: 'cs_test_1',
    });
  });

  it('passes package price/currency/metadata to Stripe', async () => {
    await ctx.svc.createCheckout({
      accountId: 7,
      packageId: PACKAGE.id,
      successUrl: 'https://example.com/success',
      cancelUrl: 'https://example.com/cancel',
    });
    expect(ctx.stripe.received).toMatchObject({
      packageName: 'Starter Pack',
      amountTotal: 499,
      currency: 'USD',
      successUrl: 'https://example.com/success',
      cancelUrl: 'https://example.com/cancel',
      metadata: { accountId: '7', packageId: '5' },
    });
  });

  it('returns package_not_found for a missing package', async () => {
    const result = await ctx.svc.createCheckout({
      accountId: 7,
      packageId: 999,
      successUrl: 'x',
      cancelUrl: 'y',
    });
    expect(result).toEqual({ ok: false, error: 'package_not_found' });
    expect(ctx.purchasesDb.rows).toHaveLength(0);
  });

  it('returns package_disabled for a disabled package, without calling Stripe', async () => {
    ctx.packagesDb.packages.set(PACKAGE.id, { ...PACKAGE, enabled: false });
    const result = await ctx.svc.createCheckout({
      accountId: 7,
      packageId: PACKAGE.id,
      successUrl: 'x',
      cancelUrl: 'y',
    });
    expect(result).toEqual({ ok: false, error: 'package_disabled' });
    expect(ctx.purchasesDb.rows).toHaveLength(0);
  });

  it('returns stripe_unavailable when Stripe is not configured, without a purchase row', async () => {
    ctx.stripe.unavailable = true;
    const result = await ctx.svc.createCheckout({
      accountId: 7,
      packageId: PACKAGE.id,
      successUrl: 'x',
      cancelUrl: 'y',
    });
    expect(result).toEqual({ ok: false, error: 'stripe_unavailable' });
    expect(ctx.purchasesDb.rows).toHaveLength(0);
  });
});

describe('ClaudiumPurchasesService.markPaidFromWebhook', () => {
  let ctx: ReturnType<typeof harness>;

  beforeEach(() => {
    ctx = harness();
  });

  async function pendingPurchase(accountId = 7): Promise<string> {
    const result = await ctx.svc.createCheckout({
      accountId,
      packageId: PACKAGE.id,
      successUrl: 'x',
      cancelUrl: 'y',
    });
    if (!result.ok) throw new Error('expected ok');
    return result.sessionId;
  }

  it('credits claudiumAmount + bonusAmount to the buyer and marks the purchase paid', async () => {
    const sessionId = await pendingPurchase(7);
    const result = await ctx.svc.markPaidFromWebhook(sessionId, 'pi_123');
    expect(result.ok).toBe(true);
    expect(result.alreadyCredited).toBe(false);
    expect(result.purchase?.status).toBe('paid');
    expect(result.purchase?.stripePaymentIntentId).toBe('pi_123');
    expect(await ctx.ledger.getBalance(7)).toBe(550);
  });

  it('logs the credit against the ledger with a PURCHASE reason tied to the session', async () => {
    const sessionId = await pendingPurchase(7);
    await ctx.svc.markPaidFromWebhook(sessionId, 'pi_123');
    expect(ctx.ledgerDb.history).toEqual([
      expect.objectContaining({
        accountId: 7,
        amount: 550,
        type: 'PURCHASE',
        reason: `stripe-session-${sessionId}`,
      }),
    ]);
  });

  it('never double-credits a replayed webhook for the same session', async () => {
    const sessionId = await pendingPurchase(7);
    const first = await ctx.svc.markPaidFromWebhook(sessionId, 'pi_123');
    const second = await ctx.svc.markPaidFromWebhook(sessionId, 'pi_123');
    expect(first.alreadyCredited).toBe(false);
    expect(second.alreadyCredited).toBe(true);
    expect(await ctx.ledger.getBalance(7)).toBe(550);
  });

  it('returns ok:false for a session with no matching purchase', async () => {
    const result = await ctx.svc.markPaidFromWebhook('cs_unknown', null);
    expect(result.ok).toBe(false);
    expect(result.purchase).toBeNull();
  });
});

describe('ClaudiumPurchasesService.markFailedFromWebhook', () => {
  let ctx: ReturnType<typeof harness>;

  beforeEach(() => {
    ctx = harness();
  });

  it('transitions a pending purchase to expired', async () => {
    const result = await ctx.svc.createCheckout({
      accountId: 7,
      packageId: PACKAGE.id,
      successUrl: 'x',
      cancelUrl: 'y',
    });
    if (!result.ok) throw new Error('expected ok');
    const updated = await ctx.svc.markFailedFromWebhook(result.sessionId, 'expired');
    expect(updated?.status).toBe('expired');
  });

  it('never undoes an already-paid purchase (a late/out-of-order failure event)', async () => {
    const result = await ctx.svc.createCheckout({
      accountId: 7,
      packageId: PACKAGE.id,
      successUrl: 'x',
      cancelUrl: 'y',
    });
    if (!result.ok) throw new Error('expected ok');
    await ctx.svc.markPaidFromWebhook(result.sessionId, 'pi_123');
    const updated = await ctx.svc.markFailedFromWebhook(result.sessionId, 'expired');
    expect(updated).toBeNull();
    const stillPaid = await ctx.svc.getPurchaseBySessionId(result.sessionId);
    expect(stillPaid?.status).toBe('paid');
    expect(await ctx.ledger.getBalance(7)).toBe(550);
  });
});

describe('ClaudiumPurchasesService.recordWebhookEvent', () => {
  it('records a new event id and rejects a duplicate', async () => {
    const ctx = harness();
    expect(await ctx.svc.recordWebhookEvent('evt_1', 'checkout.session.completed', null)).toBe(
      true,
    );
    expect(await ctx.svc.recordWebhookEvent('evt_1', 'checkout.session.completed', null)).toBe(
      false,
    );
  });
});

describe('ClaudiumPurchasesService.listPurchases', () => {
  it('filters by accountId and status', async () => {
    const ctx = harness();
    const a = await ctx.svc.createCheckout({
      accountId: 1,
      packageId: PACKAGE.id,
      successUrl: 'x',
      cancelUrl: 'y',
    });
    ctx.stripe.nextSessionId = 'cs_test_2';
    const b = await ctx.svc.createCheckout({
      accountId: 2,
      packageId: PACKAGE.id,
      successUrl: 'x',
      cancelUrl: 'y',
    });
    if (!a.ok || !b.ok) throw new Error('expected ok');
    await ctx.svc.markPaidFromWebhook(a.sessionId, 'pi_a');

    const { rows, total } = await ctx.svc.listPurchases({
      page: 1,
      limit: 20,
      status: 'paid',
      sort: 'createdAt',
      dir: 'desc',
    });
    expect(total).toBe(1);
    expect(rows.map((r) => r.accountId)).toEqual([1]);
  });
});
