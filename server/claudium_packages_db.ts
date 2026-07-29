// Claudium Packages (Phase 7): the admin-managed catalog of Claudium
// purchase tiers ("Starter Pack", "500 Claudium", ...). The schema is
// appended to the main ensureSchema() run in db.ts (idempotent CREATE only,
// applied at every boot under the advisory lock). This module owns all SQL;
// the rules live in claudium_packages.ts, zero SQL there.
//
// price is an integer in the package's own minor currency unit (cents for
// USD), the same convention shop_products.priceUsdCents already uses, kept
// alongside its own `currency` code rather than assuming USD.

import type { Pool } from 'pg';

export type ClaudiumPackageSort = 'displayOrder' | 'name' | 'createdAt' | 'updatedAt';
export type ClaudiumPackageSortDirection = 'asc' | 'desc';

export interface ClaudiumPackageRecord {
  id: number;
  name: string;
  claudiumAmount: number;
  bonusAmount: number;
  price: number;
  currency: string;
  stripePriceId: string | null;
  enabled: boolean;
  displayOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface ClaudiumPackageWriteRow {
  name: string;
  claudiumAmount: number;
  bonusAmount: number;
  price: number;
  currency: string;
  stripePriceId: string | null;
  enabled: boolean;
  displayOrder: number;
}

export interface ClaudiumPackageListParams {
  page: number;
  limit: number;
  q: string;
  enabled?: boolean;
  sort: ClaudiumPackageSort;
  dir: ClaudiumPackageSortDirection;
}

export const CLAUDIUM_PACKAGES_SCHEMA = `
CREATE TABLE IF NOT EXISTS claudium_packages (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  claudium_amount INT NOT NULL,
  bonus_amount INT NOT NULL DEFAULT 0,
  price INT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  stripe_price_id TEXT,
  enabled BOOLEAN NOT NULL DEFAULT true,
  display_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT claudium_packages_amount_positive CHECK (claudium_amount > 0),
  CONSTRAINT claudium_packages_bonus_nonneg CHECK (bonus_amount >= 0),
  CONSTRAINT claudium_packages_price_nonneg CHECK (price >= 0)
);
-- Serves the storefront read (enabled-only, display-order first) and the
-- admin list's default sort.
CREATE INDEX IF NOT EXISTS claudium_packages_enabled_order ON claudium_packages(enabled, display_order);
`;

const PACKAGE_COLS = `id, name, claudium_amount, bonus_amount, price, currency,
  stripe_price_id, enabled, display_order, created_at, updated_at`;

const SORT_COLUMN: Record<ClaudiumPackageSort, string> = {
  displayOrder: 'display_order',
  name: 'name',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
};

interface PackageRow {
  id: number;
  name: string;
  claudium_amount: number;
  bonus_amount: number;
  price: number;
  currency: string;
  stripe_price_id: string | null;
  enabled: boolean;
  display_order: number;
  created_at: Date | string;
  updated_at: Date | string;
}

function isoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function toRecord(row: PackageRow): ClaudiumPackageRecord {
  return {
    id: row.id,
    name: row.name,
    claudiumAmount: row.claudium_amount,
    bonusAmount: row.bonus_amount,
    price: row.price,
    currency: row.currency,
    stripePriceId: row.stripe_price_id,
    enabled: row.enabled,
    displayOrder: row.display_order,
    createdAt: isoString(row.created_at),
    updatedAt: isoString(row.updated_at),
  };
}

export interface ClaudiumPackagesDb {
  insertPackage(row: ClaudiumPackageWriteRow): Promise<ClaudiumPackageRecord>;
  getPackage(id: number): Promise<ClaudiumPackageRecord | null>;
  listPackages(
    params: ClaudiumPackageListParams,
  ): Promise<{ rows: ClaudiumPackageRecord[]; total: number }>;
  updatePackage(
    id: number,
    patch: Partial<ClaudiumPackageWriteRow>,
  ): Promise<ClaudiumPackageRecord | null>;
  deletePackage(id: number): Promise<boolean>;
}

export class PgClaudiumPackagesDb implements ClaudiumPackagesDb {
  constructor(private readonly pool: Pool) {}

  async insertPackage(row: ClaudiumPackageWriteRow): Promise<ClaudiumPackageRecord> {
    const res = await this.pool.query<PackageRow>(
      `INSERT INTO claudium_packages
         (name, claudium_amount, bonus_amount, price, currency, stripe_price_id, enabled, display_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING ${PACKAGE_COLS}`,
      [
        row.name,
        row.claudiumAmount,
        row.bonusAmount,
        row.price,
        row.currency,
        row.stripePriceId,
        row.enabled,
        row.displayOrder,
      ],
    );
    return toRecord(res.rows[0] as PackageRow);
  }

  async getPackage(id: number): Promise<ClaudiumPackageRecord | null> {
    const res = await this.pool.query<PackageRow>(
      `SELECT ${PACKAGE_COLS} FROM claudium_packages WHERE id = $1`,
      [id],
    );
    return res.rows[0] ? toRecord(res.rows[0]) : null;
  }

  async listPackages(
    params: ClaudiumPackageListParams,
  ): Promise<{ rows: ClaudiumPackageRecord[]; total: number }> {
    const conditions: string[] = [];
    const values: unknown[] = [];
    if (params.q) {
      values.push(`%${params.q}%`);
      conditions.push(`name ILIKE $${values.length}`);
    }
    if (params.enabled !== undefined) {
      values.push(params.enabled);
      conditions.push(`enabled = $${values.length}`);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const sortCol = SORT_COLUMN[params.sort];
    const dir = params.dir === 'asc' ? 'ASC' : 'DESC';
    const totalRes = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM claudium_packages ${where}`,
      values,
    );
    values.push(params.limit, (params.page - 1) * params.limit);
    const rowsRes = await this.pool.query<PackageRow>(
      `SELECT ${PACKAGE_COLS} FROM claudium_packages ${where}
        ORDER BY ${sortCol} ${dir}, id ASC
        LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values,
    );
    return {
      rows: rowsRes.rows.map(toRecord),
      total: Number(totalRes.rows[0]?.count ?? 0),
    };
  }

  async updatePackage(
    id: number,
    patch: Partial<ClaudiumPackageWriteRow>,
  ): Promise<ClaudiumPackageRecord | null> {
    const sets: string[] = [];
    const values: unknown[] = [];
    const columnFor: Record<keyof ClaudiumPackageWriteRow, string> = {
      name: 'name',
      claudiumAmount: 'claudium_amount',
      bonusAmount: 'bonus_amount',
      price: 'price',
      currency: 'currency',
      stripePriceId: 'stripe_price_id',
      enabled: 'enabled',
      displayOrder: 'display_order',
    };
    for (const key of Object.keys(patch) as (keyof ClaudiumPackageWriteRow)[]) {
      values.push(patch[key]);
      sets.push(`${columnFor[key]} = $${values.length}`);
    }
    if (sets.length === 0) return this.getPackage(id);
    values.push(id);
    const res = await this.pool.query<PackageRow>(
      `UPDATE claudium_packages SET ${sets.join(', ')}, updated_at = now()
        WHERE id = $${values.length}
        RETURNING ${PACKAGE_COLS}`,
      values,
    );
    return res.rows[0] ? toRecord(res.rows[0]) : null;
  }

  async deletePackage(id: number): Promise<boolean> {
    const res = await this.pool.query(`DELETE FROM claudium_packages WHERE id = $1`, [id]);
    return (res.rowCount ?? 0) > 0;
  }
}
