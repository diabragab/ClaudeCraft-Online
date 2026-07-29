import { describe, expect, it } from 'vitest';
import { ClaudiumLedgerService } from '../server/claudium_ledger';
import type {
  ClaudiumDebitResult,
  ClaudiumHistoryEntry,
  ClaudiumLedgerDb,
  ClaudiumTransactionType,
} from '../server/claudium_ledger_db';

// In-memory fake mirroring PgClaudiumLedgerDb's contract (server/CLAUDE.md:
// "Endpoint tests: FakeDb, not a pg-mock"). Balances never go negative; the
// fake enforces the same invariant the real transactional debit does.
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
    return this.history
      .filter((h) => h.accountId === accountId)
      .sort((a, b) => b.id - a.id)
      .slice(0, limit);
  }
}

function service(): { db: FakeClaudiumLedgerDb; svc: ClaudiumLedgerService } {
  const db = new FakeClaudiumLedgerDb();
  return { db, svc: new ClaudiumLedgerService(db) };
}

describe('ClaudiumLedgerService', () => {
  it('getBalance reads through to the db, defaulting to 0 for a new account', async () => {
    const { svc } = service();
    expect(await svc.getBalance(1)).toBe(0);
  });

  it('addBalance credits the account and logs the transaction', async () => {
    const { svc, db } = service();
    const balance = await svc.addBalance(1, 500, 'ADMIN_ADD', 'seed');
    expect(balance).toBe(500);
    expect(await svc.getBalance(1)).toBe(500);
    expect(db.history).toEqual([
      expect.objectContaining({ accountId: 1, amount: 500, type: 'ADMIN_ADD', reason: 'seed' }),
    ]);
  });

  it('removeBalance debits the account and logs the transaction', async () => {
    const { svc, db } = service();
    await svc.addBalance(1, 500, 'REWARD', 'daily');
    const result = await svc.removeBalance(1, 200, 'PURCHASE', 'shop-order-1');
    expect(result).toEqual({ ok: true, balance: 300 });
    expect(await svc.getBalance(1)).toBe(300);
    expect(db.history[1]).toEqual(
      expect.objectContaining({ accountId: 1, amount: -200, type: 'PURCHASE' }),
    );
  });

  it('removeBalance refuses an insufficient balance with no partial write', async () => {
    const { svc, db } = service();
    await svc.addBalance(1, 100, 'REWARD', 'daily');
    const result = await svc.removeBalance(1, 200, 'PURCHASE', 'shop-order-1');
    expect(result).toEqual({ ok: false, balance: null });
    expect(await svc.getBalance(1)).toBe(100);
    expect(db.history).toHaveLength(1);
  });

  it('hasEnough compares the current balance against the requested amount', async () => {
    const { svc } = service();
    await svc.addBalance(1, 500, 'REWARD', 'daily');
    expect(await svc.hasEnough(1, 500)).toBe(true);
    expect(await svc.hasEnough(1, 501)).toBe(false);
    expect(await svc.hasEnough(2, 1)).toBe(false);
  });

  it('getHistory returns newest first and defaults its limit', async () => {
    const { svc } = service();
    await svc.addBalance(1, 100, 'ADMIN_ADD', 'first');
    await svc.addBalance(1, 100, 'ADMIN_ADD', 'second');
    const history = await svc.getHistory(1);
    expect(history.map((h) => h.reason)).toEqual(['second', 'first']);
  });

  it('getHistory respects an explicit limit', async () => {
    const { svc } = service();
    await svc.addBalance(1, 100, 'ADMIN_ADD', 'first');
    await svc.addBalance(1, 100, 'ADMIN_ADD', 'second');
    const history = await svc.getHistory(1, 1);
    expect(history).toHaveLength(1);
    expect(history[0]?.reason).toBe('second');
  });
});
