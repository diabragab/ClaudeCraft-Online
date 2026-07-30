// Claudium ledger (Phase 7): the account-level Claudium balance and its
// append-only transaction history, owned entirely by this game server (no
// external economy service). The schema is appended to the main
// ensureSchema() run in db.ts (idempotent CREATE only, applied at every boot
// under the advisory lock, after the core `accounts` table exists).
//
// Every balance mutation is one Postgres transaction: lock the account's
// balance row (creating it at 0 first if this is the account's first ever
// Claudium movement), apply the delta, then insert the matching
// claudium_history row, so a balance and the log entry that explains it can
// never drift apart. A debit that would take the balance negative is
// refused inside the same transaction, before either row is touched.

import type { Pool, PoolClient } from 'pg';

export type ClaudiumTransactionType =
  | 'PURCHASE'
  | 'ADMIN_ADD'
  | 'ADMIN_REMOVE'
  | 'REWARD'
  | 'REFUND';

export const CLAUDIUM_TRANSACTION_TYPES: readonly ClaudiumTransactionType[] = [
  'PURCHASE',
  'ADMIN_ADD',
  'ADMIN_REMOVE',
  'REWARD',
  'REFUND',
];

export interface ClaudiumHistoryEntry {
  id: number;
  accountId: number;
  amount: number;
  type: ClaudiumTransactionType;
  reason: string;
  createdAt: string;
}

export type ClaudiumDebitResult =
  | { ok: true; balance: number }
  | { ok: false; error: 'insufficient_balance' };

export const CLAUDIUM_LEDGER_SCHEMA = `
CREATE TABLE IF NOT EXISTS claudium_accounts (
  account_id INT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  balance BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT claudium_accounts_balance_nonneg CHECK (balance >= 0)
);
CREATE TABLE IF NOT EXISTS claudium_history (
  id SERIAL PRIMARY KEY,
  account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  amount BIGINT NOT NULL,
  type TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT claudium_history_type_valid CHECK (
    type IN ('PURCHASE', 'ADMIN_ADD', 'ADMIN_REMOVE', 'REWARD', 'REFUND')
  )
);
-- Postgres does not auto-index the referencing side of an FK (see
-- server/maps_db.ts for the same lesson); serves both the account lookup
-- and, combined with created_at, the history read below.
CREATE INDEX IF NOT EXISTS claudium_history_account ON claudium_history(account_id, created_at DESC, id DESC);
`;

export interface ClaudiumLedgerDb {
  getBalance(accountId: number): Promise<number>;
  addBalance(
    accountId: number,
    amount: number,
    type: ClaudiumTransactionType,
    reason: string,
  ): Promise<number>;
  removeBalance(
    accountId: number,
    amount: number,
    type: ClaudiumTransactionType,
    reason: string,
  ): Promise<ClaudiumDebitResult>;
  getHistory(accountId: number, limit: number): Promise<ClaudiumHistoryEntry[]>;
}

interface HistoryRow {
  id: number;
  account_id: number;
  amount: string | number;
  type: ClaudiumTransactionType;
  reason: string;
  created_at: Date | string;
}

function toHistoryEntry(row: HistoryRow): ClaudiumHistoryEntry {
  return {
    id: row.id,
    accountId: row.account_id,
    amount: Number(row.amount),
    type: row.type,
    reason: row.reason,
    createdAt:
      row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  };
}

export class PgClaudiumLedgerDb implements ClaudiumLedgerDb {
  constructor(private readonly pool: Pool) {}

  async getBalance(accountId: number): Promise<number> {
    const res = await this.pool.query<{ balance: string }>(
      `SELECT balance FROM claudium_accounts WHERE account_id = $1`,
      [accountId],
    );
    return res.rows[0] ? Number(res.rows[0].balance) : 0;
  }

  async addBalance(
    accountId: number,
    amount: number,
    type: ClaudiumTransactionType,
    reason: string,
  ): Promise<number> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const current = await this.lockRow(client, accountId);
      const balance = current + amount;
      await this.writeBalanceAndHistory(client, accountId, balance, amount, type, reason);
      await client.query('COMMIT');
      return balance;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async removeBalance(
    accountId: number,
    amount: number,
    type: ClaudiumTransactionType,
    reason: string,
  ): Promise<ClaudiumDebitResult> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const current = await this.lockRow(client, accountId);
      if (current < amount) {
        await client.query('ROLLBACK');
        return { ok: false, error: 'insufficient_balance' };
      }
      const balance = current - amount;
      await this.writeBalanceAndHistory(client, accountId, balance, -amount, type, reason);
      await client.query('COMMIT');
      return { ok: true, balance };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async getHistory(accountId: number, limit: number): Promise<ClaudiumHistoryEntry[]> {
    const res = await this.pool.query<HistoryRow>(
      `SELECT id, account_id, amount, type, reason, created_at FROM claudium_history
        WHERE account_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2`,
      [accountId, limit],
    );
    return res.rows.map(toHistoryEntry);
  }

  /** Creates the account's ledger row at 0 on first touch, then locks and returns the current balance. */
  private async lockRow(client: PoolClient, accountId: number): Promise<number> {
    await client.query(
      `INSERT INTO claudium_accounts (account_id, balance) VALUES ($1, 0)
       ON CONFLICT (account_id) DO NOTHING`,
      [accountId],
    );
    const res = await client.query<{ balance: string }>(
      `SELECT balance FROM claudium_accounts WHERE account_id = $1 FOR UPDATE`,
      [accountId],
    );
    return res.rows[0] ? Number(res.rows[0].balance) : 0;
  }

  private async writeBalanceAndHistory(
    client: PoolClient,
    accountId: number,
    balance: number,
    delta: number,
    type: ClaudiumTransactionType,
    reason: string,
  ): Promise<void> {
    await client.query(
      `UPDATE claudium_accounts SET balance = $2, updated_at = now() WHERE account_id = $1`,
      [accountId, balance],
    );
    await client.query(
      `INSERT INTO claudium_history (account_id, amount, type, reason) VALUES ($1, $2, $3, $4)`,
      [accountId, delta, type, reason],
    );
  }
}
