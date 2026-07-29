// Claudium Package purchases (Phase 8): one row per Stripe Checkout Session
// created for a Claudium Packages purchase, plus the webhook delivery audit
// log. The schema is appended to the main ensureSchema() run in db.ts
// (idempotent CREATE only, applied at every boot under the advisory lock,
// after claudium_packages since package_id references it). This module owns
// all SQL; the rules live in claudium_purchases.ts, zero SQL there.
//
// Both tables are financial/audit records and are never pruned by the
// retention sweep (server/CLAUDE.md Hot paths: every unbounded table gets a
// retention story; this one's story is "keep forever", the same posture
// bank_ledger already takes).

import type { Pool } from 'pg';

export type ClaudiumPurchaseStatus = 'pending' | 'paid' | 'failed' | 'expired' | 'refunded';

export interface ClaudiumPurchaseRecord {
  id: number;
  accountId: number;
  accountUsername: string;
  packageId: number | null;
  packageName: string;
  claudiumAmount: number;
  bonusAmount: number;
  amountTotal: number;
  currency: string;
  status: ClaudiumPurchaseStatus;
  stripeSessionId: string;
  stripePaymentIntentId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ClaudiumPurchaseWriteRow {
  accountId: number;
  packageId: number;
  packageName: string;
  claudiumAmount: number;
  bonusAmount: number;
  amountTotal: number;
  currency: string;
  stripeSessionId: string;
}

export interface ClaudiumPurchaseListParams {
  page: number;
  limit: number;
  accountId?: number;
  status?: ClaudiumPurchaseStatus;
  sort: 'createdAt' | 'updatedAt';
  dir: 'asc' | 'desc';
}

export const CLAUDIUM_PURCHASES_SCHEMA = `
CREATE TABLE IF NOT EXISTS claudium_package_purchases (
  id SERIAL PRIMARY KEY,
  account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  package_id INT REFERENCES claudium_packages(id) ON DELETE SET NULL,
  package_name TEXT NOT NULL,
  claudium_amount INT NOT NULL,
  bonus_amount INT NOT NULL DEFAULT 0,
  amount_total INT NOT NULL,
  currency TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  stripe_session_id TEXT NOT NULL,
  stripe_payment_intent_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT claudium_package_purchases_status_valid CHECK (
    status IN ('pending', 'paid', 'failed', 'expired', 'refunded')
  ),
  CONSTRAINT claudium_package_purchases_claudium_positive CHECK (claudium_amount > 0),
  CONSTRAINT claudium_package_purchases_bonus_nonneg CHECK (bonus_amount >= 0),
  CONSTRAINT claudium_package_purchases_amount_nonneg CHECK (amount_total >= 0)
);
-- One Stripe Checkout Session maps to exactly one purchase row; this unique
-- index is also what a webhook replay looks the row up by.
CREATE UNIQUE INDEX IF NOT EXISTS claudium_package_purchases_session
  ON claudium_package_purchases(stripe_session_id);
-- Serves the admin payment-history list (newest first, optionally by
-- account/status) and the player-facing purchase-status poll.
CREATE INDEX IF NOT EXISTS claudium_package_purchases_account
  ON claudium_package_purchases(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS claudium_package_purchases_status
  ON claudium_package_purchases(status, created_at DESC);

-- Stripe webhook delivery log: an audit trail of every event this server has
-- received, keyed on Stripe's own event id so a replay is provably a
-- duplicate. This is audit logging; the PRIMARY idempotency guard against a
-- double credit is the atomic pending->paid transition on the purchase row
-- itself (claudium_purchases.ts markPaidFromWebhook), not this table.
CREATE TABLE IF NOT EXISTS stripe_webhook_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  purchase_id INT REFERENCES claudium_package_purchases(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS stripe_webhook_events_purchase ON stripe_webhook_events(purchase_id);
`;

const PURCHASE_COLS = `p.id, p.account_id, a.username AS account_username, p.package_id,
  p.package_name, p.claudium_amount, p.bonus_amount, p.amount_total, p.currency,
  p.status, p.stripe_session_id, p.stripe_payment_intent_id, p.created_at, p.updated_at`;

interface PurchaseRow {
  id: number;
  account_id: number;
  account_username: string;
  package_id: number | null;
  package_name: string;
  claudium_amount: number;
  bonus_amount: number;
  amount_total: number;
  currency: string;
  status: ClaudiumPurchaseStatus;
  stripe_session_id: string;
  stripe_payment_intent_id: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

function isoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function toRecord(row: PurchaseRow): ClaudiumPurchaseRecord {
  return {
    id: row.id,
    accountId: row.account_id,
    accountUsername: row.account_username,
    packageId: row.package_id,
    packageName: row.package_name,
    claudiumAmount: row.claudium_amount,
    bonusAmount: row.bonus_amount,
    amountTotal: row.amount_total,
    currency: row.currency,
    status: row.status,
    stripeSessionId: row.stripe_session_id,
    stripePaymentIntentId: row.stripe_payment_intent_id,
    createdAt: isoString(row.created_at),
    updatedAt: isoString(row.updated_at),
  };
}

const SORT_COLUMN: Record<ClaudiumPurchaseListParams['sort'], string> = {
  createdAt: 'p.created_at',
  updatedAt: 'p.updated_at',
};

export interface ClaudiumPurchasesDb {
  insertPurchase(row: ClaudiumPurchaseWriteRow): Promise<ClaudiumPurchaseRecord>;
  getPurchaseBySessionId(sessionId: string): Promise<ClaudiumPurchaseRecord | null>;
  listPurchases(
    params: ClaudiumPurchaseListParams,
  ): Promise<{ rows: ClaudiumPurchaseRecord[]; total: number }>;
  /** Atomically claims the pending->paid transition (UPDATE ... WHERE
   *  status = 'pending'); returns null if the row was missing or already
   *  past 'pending' (someone else's claim, or a stale replay), so the
   *  caller credits the ledger AT MOST ONCE per purchase no matter how many
   *  times the webhook fires. */
  markPurchasePaid(
    sessionId: string,
    paymentIntentId: string | null,
  ): Promise<ClaudiumPurchaseRecord | null>;
  /** Transitions a still-pending purchase to 'failed' or 'expired'; a no-op
   *  (returns null) once the purchase has left 'pending' (paid or already
   *  terminal), so a late failure webhook can never undo a completed sale. */
  markPurchaseTerminal(
    sessionId: string,
    status: 'failed' | 'expired',
  ): Promise<ClaudiumPurchaseRecord | null>;
  /** Records a webhook delivery for the audit log. Returns false when this
   *  event id was already recorded (a Stripe retry), true on first sight. */
  recordWebhookEvent(eventId: string, type: string, purchaseId: number | null): Promise<boolean>;
}

export class PgClaudiumPurchasesDb implements ClaudiumPurchasesDb {
  constructor(private readonly pool: Pool) {}

  async insertPurchase(row: ClaudiumPurchaseWriteRow): Promise<ClaudiumPurchaseRecord> {
    const res = await this.pool.query<PurchaseRow>(
      `WITH inserted AS (
         INSERT INTO claudium_package_purchases
           (account_id, package_id, package_name, claudium_amount, bonus_amount,
            amount_total, currency, stripe_session_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *
       )
       SELECT ${PURCHASE_COLS} FROM inserted p JOIN accounts a ON a.id = p.account_id`,
      [
        row.accountId,
        row.packageId,
        row.packageName,
        row.claudiumAmount,
        row.bonusAmount,
        row.amountTotal,
        row.currency,
        row.stripeSessionId,
      ],
    );
    return toRecord(res.rows[0] as PurchaseRow);
  }

  async getPurchaseBySessionId(sessionId: string): Promise<ClaudiumPurchaseRecord | null> {
    const res = await this.pool.query<PurchaseRow>(
      `SELECT ${PURCHASE_COLS} FROM claudium_package_purchases p
         JOIN accounts a ON a.id = p.account_id
        WHERE p.stripe_session_id = $1`,
      [sessionId],
    );
    return res.rows[0] ? toRecord(res.rows[0]) : null;
  }

  async listPurchases(
    params: ClaudiumPurchaseListParams,
  ): Promise<{ rows: ClaudiumPurchaseRecord[]; total: number }> {
    const conditions: string[] = [];
    const values: unknown[] = [];
    if (params.accountId !== undefined) {
      values.push(params.accountId);
      conditions.push(`p.account_id = $${values.length}`);
    }
    if (params.status !== undefined) {
      values.push(params.status);
      conditions.push(`p.status = $${values.length}`);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const sortCol = SORT_COLUMN[params.sort];
    const dir = params.dir === 'asc' ? 'ASC' : 'DESC';
    const totalRes = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM claudium_package_purchases p ${where}`,
      values,
    );
    values.push(params.limit, (params.page - 1) * params.limit);
    const rowsRes = await this.pool.query<PurchaseRow>(
      `SELECT ${PURCHASE_COLS} FROM claudium_package_purchases p
         JOIN accounts a ON a.id = p.account_id
         ${where}
        ORDER BY ${sortCol} ${dir}, p.id ${dir}
        LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values,
    );
    return {
      rows: rowsRes.rows.map(toRecord),
      total: Number(totalRes.rows[0]?.count ?? 0),
    };
  }

  async markPurchasePaid(
    sessionId: string,
    paymentIntentId: string | null,
  ): Promise<ClaudiumPurchaseRecord | null> {
    const res = await this.pool.query<PurchaseRow>(
      `WITH updated AS (
         UPDATE claudium_package_purchases
            SET status = 'paid', stripe_payment_intent_id = $2, updated_at = now()
          WHERE stripe_session_id = $1 AND status = 'pending'
          RETURNING *
       )
       SELECT ${PURCHASE_COLS} FROM updated p JOIN accounts a ON a.id = p.account_id`,
      [sessionId, paymentIntentId],
    );
    return res.rows[0] ? toRecord(res.rows[0]) : null;
  }

  async markPurchaseTerminal(
    sessionId: string,
    status: 'failed' | 'expired',
  ): Promise<ClaudiumPurchaseRecord | null> {
    const res = await this.pool.query<PurchaseRow>(
      `WITH updated AS (
         UPDATE claudium_package_purchases
            SET status = $2, updated_at = now()
          WHERE stripe_session_id = $1 AND status = 'pending'
          RETURNING *
       )
       SELECT ${PURCHASE_COLS} FROM updated p JOIN accounts a ON a.id = p.account_id`,
      [sessionId, status],
    );
    return res.rows[0] ? toRecord(res.rows[0]) : null;
  }

  async recordWebhookEvent(
    eventId: string,
    type: string,
    purchaseId: number | null,
  ): Promise<boolean> {
    const res = await this.pool.query(
      `INSERT INTO stripe_webhook_events (id, type, purchase_id) VALUES ($1, $2, $3)
       ON CONFLICT (id) DO NOTHING`,
      [eventId, type, purchaseId],
    );
    return (res.rowCount ?? 0) > 0;
  }
}
