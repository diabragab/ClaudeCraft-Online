// Unit coverage for the Premium Shop announcement-config admin route layer
// (server/shop_announcement_config_routes.ts). Same harness pattern as
// shop_products_routes.test.ts (requireAdmin over a faked admin-auth db via
// server/admin.ts's setAdminDbForTests), but the DB layer here is three plain
// functions (server/shop_announcement_config_db.ts), not a swappable service
// singleton, so it is mocked directly.
process.env.DATABASE_URL ||=
  'postgres://test:test@127.0.0.1:5433/wocc_shop_announcement_config_routes';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('pg', () => ({
  Pool: vi.fn(function Pool() {
    return { query: vi.fn(), connect: vi.fn() };
  }),
}));

const dbMocks = vi.hoisted(() => ({
  loadShopAnnouncementConfig: vi.fn(),
  saveShopAnnouncementConfigChange: vi.fn(),
  listShopAnnouncementConfigHistory: vi.fn(),
}));
vi.mock('../../server/shop_announcement_config_db', () => dbMocks);

import { resetAdminDbForTests, setAdminDbForTests } from '../../server/admin';
import { compose } from '../../server/http/compose';
import { withErrors } from '../../server/http/middleware/with_errors';
import type { Ctx, Middleware } from '../../server/http/types';
import { routes } from '../../server/shop_announcement_config_routes';
import { fakeCtx } from './helpers';

const BEARER = `Bearer ${'a'.repeat(64)}`;

function authedAs(roles: string[]): void {
  setAdminDbForTests({
    accountAndScopeForToken: async () => ({ accountId: 1, scope: 'full' }),
    adminRolesForAccount: async () => ({ username: 'op', roles }),
  });
}

function routeFor(method: string, path: string) {
  const route = routes.find((r) => r.method === method && r.path === path);
  if (!route) throw new Error(`no route ${method} ${path}`);
  return route;
}

function runRoute(route: (typeof routes)[number], ctx: Ctx): Promise<void> {
  const stack: Middleware[] = [
    withErrors({ surface: route.meta?.envelope }),
    ...(route.middleware ?? []),
    async (c) => {
      await route.handler(c);
    },
  ];
  return compose(stack)(ctx);
}

interface FakeResShape {
  statusCode: number;
  body: string;
}
function captured(ctx: Ctx): { status: number; body: unknown } {
  const fake = ctx.res as unknown as FakeResShape;
  return { status: fake.statusCode, body: fake.body ? JSON.parse(fake.body) : undefined };
}

beforeEach(() => {
  dbMocks.loadShopAnnouncementConfig.mockReset().mockResolvedValue({ data: {}, updatedAt: null });
  dbMocks.saveShopAnnouncementConfigChange
    .mockReset()
    .mockResolvedValue({ changed: true, updatedAt: '2026-01-01T00:00:00.000Z' });
  dbMocks.listShopAnnouncementConfigHistory.mockReset().mockResolvedValue([]);
});

afterEach(() => {
  resetAdminDbForTests();
});

describe('shop announcement config routes: authorization', () => {
  it('401s without a bearer token', async () => {
    const route = routeFor('GET', '/admin/api/shop/announcement-config');
    const ctx = fakeCtx({ method: 'GET', url: '/admin/api/shop/announcement-config' });
    await runRoute(route, ctx);
    expect(captured(ctx).status).toBe(401);
  });

  it('403s a save from a role without shop.manage (viewer has shop.read only)', async () => {
    authedAs(['viewer']);
    const route = routeFor('POST', '/admin/api/shop/announcement-config');
    const ctx = fakeCtx({
      method: 'POST',
      url: '/admin/api/shop/announcement-config',
      headers: { authorization: BEARER },
      body: {},
    });
    await runRoute(route, ctx);
    expect(captured(ctx).status).toBe(403);
  });
});

describe('shop announcement config routes: read', () => {
  it('returns the defaulted config when nothing has ever been saved', async () => {
    authedAs(['admin']);
    const route = routeFor('GET', '/admin/api/shop/announcement-config');
    const ctx = fakeCtx({
      method: 'GET',
      url: '/admin/api/shop/announcement-config',
      headers: { authorization: BEARER },
    });
    await runRoute(route, ctx);
    const { status, body } = captured(ctx);
    expect(status).toBe(200);
    expect(body).toMatchObject({
      data: {
        config: {
          enabled: true,
          minRarity: 'epic',
          discordWebhookEnabled: false,
        },
        updatedAt: null,
      },
    });
  });

  it('reflects a stored document', async () => {
    authedAs(['admin']);
    dbMocks.loadShopAnnouncementConfig.mockResolvedValue({
      data: { enabled: false, minRarity: 'legendary' },
      updatedAt: '2026-02-01T00:00:00.000Z',
    });
    const route = routeFor('GET', '/admin/api/shop/announcement-config');
    const ctx = fakeCtx({
      method: 'GET',
      url: '/admin/api/shop/announcement-config',
      headers: { authorization: BEARER },
    });
    await runRoute(route, ctx);
    const { body } = captured(ctx);
    expect(
      (body as { data: { config: { enabled: boolean; minRarity: string } } }).data.config,
    ).toEqual(expect.objectContaining({ enabled: false, minRarity: 'legendary' }));
  });

  it('lists the audit history', async () => {
    authedAs(['admin']);
    dbMocks.listShopAnnouncementConfigHistory.mockResolvedValue([
      {
        id: 1,
        beforeData: {},
        afterData: { enabled: true },
        note: 'initial setup',
        createdAt: '2026-01-01T00:00:00.000Z',
        adminAccountId: 1,
        adminUsername: 'op',
      },
    ]);
    const route = routeFor('GET', '/admin/api/shop/announcement-config/history');
    const ctx = fakeCtx({
      method: 'GET',
      url: '/admin/api/shop/announcement-config/history',
      headers: { authorization: BEARER },
    });
    await runRoute(route, ctx);
    const { status, body } = captured(ctx);
    expect(status).toBe(200);
    expect((body as { data: { entries: unknown[] } }).data.entries).toHaveLength(1);
  });
});

describe('shop announcement config routes: save', () => {
  it('validates, saves, and returns the effective config', async () => {
    authedAs(['admin']);
    const route = routeFor('POST', '/admin/api/shop/announcement-config');
    const ctx = fakeCtx({
      method: 'POST',
      url: '/admin/api/shop/announcement-config',
      headers: { authorization: BEARER },
      body: {
        enabled: true,
        minRarity: 'legendary',
        messageTemplate: '{player} snagged {item}!',
        discordWebhookEnabled: true,
        discordWebhookUrl: 'https://discord.com/api/webhooks/1/token',
        note: 'tightened the threshold',
      },
    });
    await runRoute(route, ctx);
    const { status, body } = captured(ctx);
    expect(status).toBe(200);
    expect(dbMocks.saveShopAnnouncementConfigChange).toHaveBeenCalledWith(
      {
        enabled: true,
        minRarity: 'legendary',
        messageTemplate: '{player} snagged {item}!',
        discordWebhookEnabled: true,
        discordWebhookUrl: 'https://discord.com/api/webhooks/1/token',
      },
      1,
      'tightened the threshold',
    );
    expect((body as { data: { config: { minRarity: string } } }).data.config.minRarity).toBe(
      'legendary',
    );
  });

  it('422s an unknown rarity tier', async () => {
    authedAs(['admin']);
    const route = routeFor('POST', '/admin/api/shop/announcement-config');
    const ctx = fakeCtx({
      method: 'POST',
      url: '/admin/api/shop/announcement-config',
      headers: { authorization: BEARER },
      body: { minRarity: 'godlike' },
    });
    await runRoute(route, ctx);
    expect(captured(ctx).status).toBe(422);
    expect(dbMocks.saveShopAnnouncementConfigChange).not.toHaveBeenCalled();
  });

  it('defaults every field when the body is empty', async () => {
    authedAs(['admin']);
    const route = routeFor('POST', '/admin/api/shop/announcement-config');
    const ctx = fakeCtx({
      method: 'POST',
      url: '/admin/api/shop/announcement-config',
      headers: { authorization: BEARER },
      body: {},
    });
    await runRoute(route, ctx);
    expect(captured(ctx).status).toBe(200);
    expect(dbMocks.saveShopAnnouncementConfigChange).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: true, minRarity: 'epic' }),
      1,
      '',
    );
  });
});

describe('shop announcement config routes: test-discord', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts to an explicitly given URL and reports the real HTTP outcome', async () => {
    authedAs(['admin']);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal('fetch', fetchMock);
    const route = routeFor('POST', '/admin/api/shop/announcement-config/test-discord');
    const ctx = fakeCtx({
      method: 'POST',
      url: '/admin/api/shop/announcement-config/test-discord',
      headers: { authorization: BEARER },
      body: { url: 'https://discord.com/api/webhooks/9/abc' },
    });
    await runRoute(route, ctx);
    const { status, body } = captured(ctx);
    expect(status).toBe(200);
    expect(body).toEqual({
      success: true,
      data: { ok: true, status: 204, error: null },
      error: null,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://discord.com/api/webhooks/9/abc',
      expect.any(Object),
    );
    expect(dbMocks.loadShopAnnouncementConfig).not.toHaveBeenCalled();
  });

  it('falls back to the saved webhook URL when none is given', async () => {
    authedAs(['admin']);
    dbMocks.loadShopAnnouncementConfig.mockResolvedValue({
      data: { discordWebhookUrl: 'https://discord.com/api/webhooks/saved/token' },
      updatedAt: null,
    });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal('fetch', fetchMock);
    const route = routeFor('POST', '/admin/api/shop/announcement-config/test-discord');
    const ctx = fakeCtx({
      method: 'POST',
      url: '/admin/api/shop/announcement-config/test-discord',
      headers: { authorization: BEARER },
      body: {},
    });
    await runRoute(route, ctx);
    expect(captured(ctx).status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://discord.com/api/webhooks/saved/token',
      expect.any(Object),
    );
  });

  it('400s when no URL is given and none is saved', async () => {
    authedAs(['admin']);
    const route = routeFor('POST', '/admin/api/shop/announcement-config/test-discord');
    const ctx = fakeCtx({
      method: 'POST',
      url: '/admin/api/shop/announcement-config/test-discord',
      headers: { authorization: BEARER },
      body: {},
    });
    await runRoute(route, ctx);
    expect(captured(ctx).status).toBe(400);
  });
});

describe('shop announcement config routes: table shape', () => {
  it('registers exactly the four admin routes', () => {
    expect(routes.map((r) => `${r.method} ${r.path}`)).toEqual([
      'GET /admin/api/shop/announcement-config',
      'POST /admin/api/shop/announcement-config',
      'GET /admin/api/shop/announcement-config/history',
      'POST /admin/api/shop/announcement-config/test-discord',
    ]);
    expect(routes.every((r) => r.surface === 'admin')).toBe(true);
  });
});
