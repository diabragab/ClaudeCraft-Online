#!/usr/bin/env node
// Grant (or remove) Claudium balance for an account, straight against the
// ledger tables (claudium_accounts/claudium_history), mirroring
// server/claudium_ledger_db.ts's own addBalance/removeBalance transaction
// exactly (lock-row-creating-it-at-0-first, apply delta, write the matching
// history row) so a CLI grant is indistinguishable from one made through the
// admin dashboard's POST /admin/api/claudium/accounts/:id/adjust.
//
//   node scripts/grant_claudium.mjs <username> <amount> [--reason "text"]
//
// amount is an integer; positive grants (ADMIN_ADD), negative removes
// (ADMIN_REMOVE, refused if it would take the balance below zero).
//
// Uses DATABASE_URL. For local dev, copy .env.example to .env first.
import pg from 'pg';

try {
  process.loadEnvFile?.();
} catch {
  // .env is optional; production operators may pass DATABASE_URL directly.
}

const args = process.argv.slice(2);
const username = args[0];
const amountArg = args[1];
const reasonFlagIndex = args.indexOf('--reason');
const reason = reasonFlagIndex >= 0 ? (args[reasonFlagIndex + 1] ?? '') : '';

const amount = Number(amountArg);
if (!username || username.startsWith('--') || !Number.isInteger(amount) || amount === 0) {
  console.error('usage: node scripts/grant_claudium.mjs <username> <amount> [--reason "text"]');
  console.error('  amount: a non-zero integer; negative removes Claudium instead of granting it');
  process.exit(1);
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL is required. For local dev, copy .env.example to .env first.');
  process.exit(1);
}
const pool = new pg.Pool({ connectionString });

try {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const account = await client.query('SELECT id FROM accounts WHERE username = $1', [username]);
    if (account.rowCount === 0) {
      await client.query('ROLLBACK');
      console.error(`no account named "${username}"; they need to register in the game first`);
      process.exit(1);
    }
    const accountId = account.rows[0].id;

    // lockRow: create the ledger row at 0 on first touch, then lock it.
    await client.query(
      `INSERT INTO claudium_accounts (account_id, balance) VALUES ($1, 0)
       ON CONFLICT (account_id) DO NOTHING`,
      [accountId],
    );
    const current = await client.query(
      'SELECT balance FROM claudium_accounts WHERE account_id = $1 FOR UPDATE',
      [accountId],
    );
    const currentBalance = Number(current.rows[0].balance);

    let newBalance;
    let delta;
    let type;
    if (amount > 0) {
      delta = amount;
      newBalance = currentBalance + amount;
      type = 'ADMIN_ADD';
    } else {
      const removeAmount = -amount;
      if (currentBalance < removeAmount) {
        await client.query('ROLLBACK');
        console.error(
          `${username} only has ${currentBalance} Claudium, cannot remove ${removeAmount}`,
        );
        process.exit(1);
      }
      delta = -removeAmount;
      newBalance = currentBalance - removeAmount;
      type = 'ADMIN_REMOVE';
    }

    await client.query(
      'UPDATE claudium_accounts SET balance = $2, updated_at = now() WHERE account_id = $1',
      [accountId, newBalance],
    );
    await client.query(
      'INSERT INTO claudium_history (account_id, amount, type, reason) VALUES ($1, $2, $3, $4)',
      [accountId, delta, type, reason],
    );
    await client.query('COMMIT');
    console.log(
      `${username} (account ${accountId}): ${currentBalance} -> ${newBalance} Claudium (${type} ${delta})`,
    );
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
} catch (err) {
  console.error('failed:', err.message);
  process.exit(1);
} finally {
  await pool.end();
}
