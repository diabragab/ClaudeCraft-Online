// Claudium ledger REST surface (Phase 7): the player-facing balance/history
// reads over the in-repo Claudium ledger (server/claudium_ledger.ts), plus
// one admin balance-adjustment route (ADMIN_ADD/ADMIN_REMOVE). Lives under
// /api/shop/claudium/* rather than /api/claudium/*: that legacy prefix is
// entirely owned by server/claudium.ts's pass-through to the external
// economy service (see its own header) and is left untouched here, so the
// two systems never collide on a path.
//
// No pricing or delivery logic lives here; that is
// server/shop_ledger_checkout.ts (POST /api/shop/buy). This module only
// reads/adjusts the ledger itself.

import { requireAdmin } from './admin';
import { ClaudiumLedgerService } from './claudium_ledger';
import { PgClaudiumLedgerDb } from './claudium_ledger_db';
import {
  type AccountModerationStatus,
  accountAndScopeForToken,
  moderationStatusForAccount,
  pool,
  type TokenScope,
} from './db';
import { adminOk } from './http/admin_envelope';
import { ctxAccountId } from './http/context';
import { HttpError } from './http/errors';
import { withBody } from './http/middleware/body';
import { requireAccount } from './http/middleware/require_account';
import {
  adminTargetId,
  adminTargetMeta,
  requireAdminTarget,
} from './http/middleware/require_admin';
import { num, object, optional, str } from './http/schema';
import type { Ctx, RouteDef } from './http/types';
import { json } from './http_util';

// ---------------------------------------------------------------------------
// The service singleton. The setter lets a unit test drive the routes with
// an in-memory fake (mirrors shop_storefront_orders_routes.ts's own pattern).
// ---------------------------------------------------------------------------

const REAL_LEDGER_SERVICE = new ClaudiumLedgerService(new PgClaudiumLedgerDb(pool));
let ledgerService = REAL_LEDGER_SERVICE;

export function setClaudiumLedgerServiceForTests(service: ClaudiumLedgerService): void {
  ledgerService = service;
}

export function resetClaudiumLedgerServiceForTests(): void {
  ledgerService = REAL_LEDGER_SERVICE;
}

// ---------------------------------------------------------------------------
// Auth (mirrors shop_storefront_orders_routes.ts's own swappable authDb bundle).
// ---------------------------------------------------------------------------

export interface ClaudiumLedgerAuthDb {
  accountAndScopeForToken(token: string): Promise<{ accountId: number; scope: TokenScope } | null>;
  moderationStatusForAccount(accountId: number): Promise<AccountModerationStatus>;
}
const REAL_AUTH_DB: ClaudiumLedgerAuthDb = { accountAndScopeForToken, moderationStatusForAccount };
let authDb = REAL_AUTH_DB;

export function setClaudiumLedgerAuthDbForTests(db: ClaudiumLedgerAuthDb): void {
  authDb = db;
}

export function resetClaudiumLedgerAuthDbForTests(): void {
  authDb = REAL_AUTH_DB;
}

const readAccount = requireAccount({
  scope: 'read',
  lookupToken: (token) => authDb.accountAndScopeForToken(token),
  moderationStatus: (accountId) => authDb.moderationStatusForAccount(accountId),
});

// ---------------------------------------------------------------------------
// Request shapes.
// ---------------------------------------------------------------------------

const historyQuerySchema = object({
  limit: optional(num({ int: true, min: 1, max: 200 }), 100),
});

const adjustBodySchema = object({
  amount: num({ int: true, min: -1_000_000_000, max: 1_000_000_000 }),
  reason: optional(str({ maxLength: 200 }), ''),
});

// ---------------------------------------------------------------------------
// Player handlers.
// ---------------------------------------------------------------------------

/** GET /api/shop/claudium/balance: the caller's own Claudium balance. */
async function balanceHandler(ctx: Ctx): Promise<void> {
  const balance = await ledgerService.getBalance(ctxAccountId(ctx));
  json(ctx.res, 200, { balance });
}

/** GET /api/shop/claudium/history: the caller's own transaction history, newest first. */
async function historyHandler(ctx: Ctx): Promise<void> {
  const decoded = historyQuerySchema.decode(ctx.query);
  if (!decoded.ok) throw decoded;
  const entries = await ledgerService.getHistory(ctxAccountId(ctx), decoded.value.limit);
  json(ctx.res, 200, { entries });
}

// ---------------------------------------------------------------------------
// Admin handler: grant (positive amount) or deduct (negative amount) an
// account's Claudium, e.g. to seed a test account or correct a support case.
// The :id param is the target accountId (requireAdminTarget's loader decodes
// ctx.params.id specifically, so this route names its param :id rather than
// :accountId to reuse the shared operator-scope loader like every other
// admin :id route).
// ---------------------------------------------------------------------------

/** POST /admin/api/claudium/accounts/:id/adjust: ADMIN_ADD or ADMIN_REMOVE. */
async function adjustHandler(ctx: Ctx): Promise<void> {
  const decoded = adjustBodySchema.decode(ctx.body ?? {});
  if (!decoded.ok) throw decoded;
  const accountId = adminTargetId(ctx);
  const { amount, reason } = decoded.value;
  if (amount === 0) throw new HttpError(400, 'shop.invalid_input');
  if (amount > 0) {
    const balance = await ledgerService.addBalance(accountId, amount, 'ADMIN_ADD', reason);
    adminOk(ctx.res, { balance });
    return;
  }
  const result = await ledgerService.removeBalance(accountId, -amount, 'ADMIN_REMOVE', reason);
  if (!result.ok) throw new HttpError(409, 'shop.insufficient_claudium');
  adminOk(ctx.res, { balance: result.balance });
}

// ---------------------------------------------------------------------------
// The route table. registry.ts spreads this into apiRoutes. Registry-only:
// no legacy ladder twin (a brand-new surface).
// ---------------------------------------------------------------------------

export const routes: RouteDef[] = [
  {
    method: 'GET',
    path: '/api/shop/claudium/balance',
    surface: 'api',
    middleware: [readAccount],
    handler: balanceHandler,
  },
  {
    method: 'GET',
    path: '/api/shop/claudium/history',
    surface: 'api',
    middleware: [readAccount],
    handler: historyHandler,
  },
  {
    method: 'POST',
    path: '/admin/api/claudium/accounts/:id/adjust',
    surface: 'admin',
    middleware: [requireAdmin, withBody(), requireAdminTarget('claudium_account')],
    meta: adminTargetMeta('claudium_account'),
    handler: adjustHandler,
  },
];
