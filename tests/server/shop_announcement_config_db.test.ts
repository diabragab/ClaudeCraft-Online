// Mirrors tests/antibot_config_db.test.ts's harness for the identically
// shaped Premium Shop announcement config table
// (server/shop_announcement_config_db.ts): one current JSONB document per
// realm plus an append-only before/after audit trail.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  poolQuery: vi.fn(),
}));

vi.mock('../../server/db', () => ({
  pool: {
    connect: mocks.connect,
    query: mocks.poolQuery,
  },
}));

vi.mock('../../server/realm', () => ({ REALM: 'test-realm' }));

import {
  listShopAnnouncementConfigHistory,
  loadShopAnnouncementConfig,
  PgShopAnnouncementConfigDb,
  resetShopAnnouncementConfigCacheForTests,
  saveShopAnnouncementConfigChange,
} from '../../server/shop_announcement_config_db';

function fakeClient(
  handler: (sql: string, params: unknown[] | undefined) => Promise<{ rows: unknown[] }>,
) {
  const query = vi.fn(handler);
  const release = vi.fn();
  mocks.connect.mockResolvedValue({ query, release });
  return { query, release };
}

beforeEach(() => {
  mocks.connect.mockReset();
  mocks.poolQuery.mockReset();
  // PgShopAnnouncementConfigDb.loadConfig() reads through a module-level
  // cache (server/CLAUDE.md's Hot paths seam); reset it so one test's
  // installed value can never leak into another's assertions.
  resetShopAnnouncementConfigCacheForTests();
});

describe('loadShopAnnouncementConfig', () => {
  it('returns an empty document with no updatedAt when nothing has been saved', async () => {
    mocks.poolQuery.mockResolvedValue({ rows: [] });
    const result = await loadShopAnnouncementConfig();
    expect(result).toEqual({ data: {}, updatedAt: null });
  });

  it('returns the stored document and its updatedAt stamp', async () => {
    mocks.poolQuery.mockResolvedValue({
      rows: [{ data: { enabled: false }, updated_at: '2026-01-01T00:00:00.000Z' }],
    });
    const result = await loadShopAnnouncementConfig();
    expect(result).toEqual({ data: { enabled: false }, updatedAt: '2026-01-01T00:00:00.000Z' });
  });
});

describe('saveShopAnnouncementConfigChange', () => {
  it('updates the current document and appends its audit row in one transaction', async () => {
    const { query, release } = fakeClient(async (sql) => {
      if (sql.includes('SELECT data')) {
        return { rows: [{ data: { enabled: true }, updated_at: null, unchanged: false }] };
      }
      if (sql.startsWith('INSERT INTO shop_announcement_config (')) {
        return { rows: [{ updated_at: '2026-02-01T00:00:00.000Z' }] };
      }
      return { rows: [] };
    });

    const result = await saveShopAnnouncementConfigChange({ enabled: false }, 7, 'tightened');

    expect(result).toEqual({ changed: true, updatedAt: '2026-02-01T00:00:00.000Z' });
    expect(query).toHaveBeenCalledWith('BEGIN');
    expect(query).toHaveBeenCalledWith('COMMIT');
    const historyInsert = query.mock.calls.find(([sql]) =>
      (sql as string).includes('INSERT INTO shop_announcement_config_changes'),
    );
    expect(historyInsert?.[1]).toEqual([
      'test-realm',
      7,
      JSON.stringify({ enabled: true }),
      JSON.stringify({ enabled: false }),
      'tightened',
    ]);
    expect(release).toHaveBeenCalled();
  });

  it('no-ops (no history row, no updated_at bump) when the document is unchanged', async () => {
    const { query } = fakeClient(async (sql) => {
      if (sql.includes('SELECT data')) {
        return {
          rows: [
            { data: { enabled: true }, updated_at: '2026-01-01T00:00:00.000Z', unchanged: true },
          ],
        };
      }
      return { rows: [] };
    });

    const result = await saveShopAnnouncementConfigChange({ enabled: true }, 7, '');

    expect(result).toEqual({ changed: false, updatedAt: '2026-01-01T00:00:00.000Z' });
    expect(query.mock.calls.some(([sql]) => (sql as string).startsWith('INSERT'))).toBe(false);
  });

  it('rolls back and rethrows on a query failure', async () => {
    const { query } = fakeClient(async (sql) => {
      if (sql.includes('SELECT data')) throw new Error('db exploded');
      return { rows: [] };
    });

    await expect(saveShopAnnouncementConfigChange({}, 7, '')).rejects.toThrow('db exploded');
    expect(query).toHaveBeenCalledWith('ROLLBACK');
  });
});

describe('listShopAnnouncementConfigHistory', () => {
  it('maps rows to the history entry shape', async () => {
    mocks.poolQuery.mockResolvedValue({
      rows: [
        {
          id: 3,
          before_data: { enabled: true },
          after_data: { enabled: false },
          note: 'disabled for maintenance',
          created_at: '2026-03-01T00:00:00.000Z',
          admin_account_id: 7,
          admin_username: 'op',
        },
      ],
    });
    const entries = await listShopAnnouncementConfigHistory();
    expect(entries).toEqual([
      {
        id: 3,
        beforeData: { enabled: true },
        afterData: { enabled: false },
        note: 'disabled for maintenance',
        createdAt: '2026-03-01T00:00:00.000Z',
        adminAccountId: 7,
        adminUsername: 'op',
      },
    ]);
  });
});

describe('PgShopAnnouncementConfigDb', () => {
  it('adapts loadConfig to loadShopAnnouncementConfig', async () => {
    mocks.poolQuery.mockResolvedValue({ rows: [{ data: { enabled: false }, updated_at: null }] });
    const reader = new PgShopAnnouncementConfigDb();
    const { data } = await reader.loadConfig();
    expect(data).toEqual({ enabled: false });
  });

  it('serves a second read from cache without hitting the pool again (the per-checkout hot path)', async () => {
    mocks.poolQuery.mockResolvedValue({ rows: [{ data: { enabled: true }, updated_at: null }] });
    const reader = new PgShopAnnouncementConfigDb();

    await reader.loadConfig();
    await reader.loadConfig();

    expect(mocks.poolQuery).toHaveBeenCalledTimes(1);
  });

  it('serves fresh data immediately after a save busts the cache', async () => {
    mocks.poolQuery.mockResolvedValue({ rows: [{ data: { enabled: true }, updated_at: null }] });
    const reader = new PgShopAnnouncementConfigDb();
    await reader.loadConfig();
    expect(mocks.poolQuery).toHaveBeenCalledTimes(1);

    fakeClient(async (sql) => {
      if (sql.includes('SELECT data')) {
        return { rows: [{ data: { enabled: true }, updated_at: null, unchanged: false }] };
      }
      if (sql.startsWith('INSERT INTO shop_announcement_config (')) {
        return { rows: [{ updated_at: '2026-02-01T00:00:00.000Z' }] };
      }
      return { rows: [] };
    });
    await saveShopAnnouncementConfigChange({ enabled: false }, 7, 'flip it off');

    mocks.poolQuery.mockResolvedValue({ rows: [{ data: { enabled: false }, updated_at: null }] });
    const { data } = await reader.loadConfig();

    expect(data).toEqual({ enabled: false });
    expect(mocks.poolQuery).toHaveBeenCalledTimes(2);
  });
});
