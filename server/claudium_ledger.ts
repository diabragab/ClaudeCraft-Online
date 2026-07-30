// Claudium ledger (Phase 7): reusable business-logic methods over
// ClaudiumLedgerDb (server/claudium_ledger_db.ts, zero SQL here). This is the
// one seam every Claudium-moving caller goes through: the in-game Shop's
// checkout (server/shop_ledger_checkout.ts), the admin balance-adjustment
// routes, and any future reward hook, so a balance and its logged reason can
// never be written by two different code paths.

import type {
  ClaudiumHistoryEntry,
  ClaudiumLedgerDb,
  ClaudiumTransactionType,
} from './claudium_ledger_db';

const DEFAULT_HISTORY_LIMIT = 100;

export class ClaudiumLedgerService {
  constructor(private readonly db: ClaudiumLedgerDb) {}

  getBalance(accountId: number): Promise<number> {
    return this.db.getBalance(accountId);
  }

  /** Credits the account. Every credit is logged; returns the resulting balance. */
  addBalance(
    accountId: number,
    amount: number,
    type: ClaudiumTransactionType,
    reason: string,
  ): Promise<number> {
    return this.db.addBalance(accountId, amount, type, reason);
  }

  /** Debits the account. Refuses (no partial write) when the balance is insufficient. */
  removeBalance(
    accountId: number,
    amount: number,
    type: ClaudiumTransactionType,
    reason: string,
  ): Promise<{ ok: boolean; balance: number | null }> {
    return this.db
      .removeBalance(accountId, amount, type, reason)
      .then((result) =>
        result.ok ? { ok: true, balance: result.balance } : { ok: false, balance: null },
      );
  }

  async hasEnough(accountId: number, amount: number): Promise<boolean> {
    const balance = await this.db.getBalance(accountId);
    return balance >= amount;
  }

  getHistory(
    accountId: number,
    limit: number = DEFAULT_HISTORY_LIMIT,
  ): Promise<ClaudiumHistoryEntry[]> {
    return this.db.getHistory(accountId, limit);
  }
}
