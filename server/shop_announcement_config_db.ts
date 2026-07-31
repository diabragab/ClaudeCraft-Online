// SQL for the Premium Shop's rarity-gated purchase-announcement config
// (Phase 2D admin panel): one current JSONB override document per realm plus
// an append-only before/after audit trail, the exact shape of
// antibot_config_db.ts's bot-detector config. Decision/formatting logic and
// live apply happen in shop_announcement.ts; this file is the only place
// this feature's SQL runs (server/CLAUDE.md: SQL lives only in db.ts and
// *_db.ts).

import { pool } from './db';
import { REALM } from './realm';
import type { ShopAnnouncementConfigReader } from './shop_announcement';

export const SHOP_ANNOUNCEMENT_CONFIG_SCHEMA = `
CREATE TABLE IF NOT EXISTS shop_announcement_config (
  realm TEXT PRIMARY KEY DEFAULT '${REALM.replace(/'/g, "''")}',
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by INT REFERENCES accounts(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS shop_announcement_config_changes (
  id BIGSERIAL PRIMARY KEY,
  realm TEXT NOT NULL,
  admin_account_id INT REFERENCES accounts(id) ON DELETE SET NULL,
  before_data JSONB NOT NULL,
  after_data JSONB NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS shop_announcement_config_changes_realm
  ON shop_announcement_config_changes(realm, created_at DESC, id DESC);
`;

export interface StoredShopAnnouncementConfig {
  data: unknown;
  updatedAt: string | null;
}

export interface ShopAnnouncementConfigSaveResult {
  changed: boolean;
  updatedAt: string | null;
}

export interface ShopAnnouncementConfigHistoryEntry {
  id: number;
  beforeData: Record<string, unknown>;
  afterData: Record<string, unknown>;
  note: string;
  createdAt: string;
  adminAccountId: number | null;
  adminUsername: string | null;
}

/** The realm's saved override document ({} when none has ever been saved). */
export async function loadShopAnnouncementConfig(): Promise<StoredShopAnnouncementConfig> {
  const res = await pool.query(
    `SELECT data, updated_at FROM shop_announcement_config WHERE realm = $1`,
    [REALM],
  );
  const row = res.rows[0];
  return {
    data: row?.data ?? {},
    updatedAt: row?.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}

/**
 * Replace the realm's override document and append its audit row atomically.
 * An unchanged document is a no-op: it does not refresh updated_at or create history.
 */
export async function saveShopAnnouncementConfigChange(
  data: Record<string, unknown>,
  updatedBy: number,
  note: string,
): Promise<ShopAnnouncementConfigSaveResult> {
  const encoded = JSON.stringify(data);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query(
      `SELECT data, updated_at, data = $2::jsonb AS unchanged
       FROM shop_announcement_config
       WHERE realm = $1
       FOR UPDATE`,
      [REALM, encoded],
    );
    const row = current.rows[0];
    if ((row && row.unchanged === true) || (!row && Object.keys(data).length === 0)) {
      await client.query('COMMIT');
      return {
        changed: false,
        updatedAt: row?.updated_at ? new Date(row.updated_at).toISOString() : null,
      };
    }

    const beforeData = documentObject(row?.data);
    const saved = await client.query(
      `INSERT INTO shop_announcement_config (realm, data, updated_at, updated_by)
       VALUES ($1, $2::jsonb, now(), $3)
       ON CONFLICT (realm) DO UPDATE
         SET data = EXCLUDED.data, updated_at = now(), updated_by = EXCLUDED.updated_by
       RETURNING updated_at`,
      [REALM, encoded, updatedBy],
    );
    await client.query(
      `INSERT INTO shop_announcement_config_changes (
         realm, admin_account_id, before_data, after_data, note
       ) VALUES ($1, $2, $3::jsonb, $4::jsonb, $5)`,
      [REALM, updatedBy, JSON.stringify(beforeData), encoded, note],
    );
    await client.query('COMMIT');
    return {
      changed: true,
      updatedAt: new Date(saved.rows[0].updated_at).toISOString(),
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export async function listShopAnnouncementConfigHistory(
  limit = 50,
): Promise<ShopAnnouncementConfigHistoryEntry[]> {
  const boundedLimit = Number.isFinite(limit) ? Math.max(1, Math.min(100, Math.trunc(limit))) : 50;
  const res = await pool.query(
    `SELECT
       h.id,
       h.before_data,
       h.after_data,
       h.note,
       h.created_at,
       h.admin_account_id,
       a.username AS admin_username
     FROM shop_announcement_config_changes h
     LEFT JOIN accounts a ON a.id = h.admin_account_id
     WHERE h.realm = $1
     ORDER BY h.created_at DESC, h.id DESC
     LIMIT $2`,
    [REALM, boundedLimit],
  );
  return res.rows.map((row) => ({
    id: Number(row.id),
    beforeData: documentObject(row.before_data),
    afterData: documentObject(row.after_data),
    note: typeof row.note === 'string' ? row.note : '',
    createdAt: new Date(row.created_at).toISOString(),
    adminAccountId: row.admin_account_id === null ? null : Number(row.admin_account_id),
    adminUsername: typeof row.admin_username === 'string' ? row.admin_username : null,
  }));
}

function documentObject(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Constructor-injectable reader for ShopAnnouncementService (server/shop_announcement.ts). */
export class PgShopAnnouncementConfigDb implements ShopAnnouncementConfigReader {
  async loadConfig(): Promise<{ data: unknown }> {
    return loadShopAnnouncementConfig();
  }
}
