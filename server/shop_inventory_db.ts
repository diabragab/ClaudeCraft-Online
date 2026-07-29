// Postgres-backed ShopInventoryDb plus the shop_inventory + shop_inventory_
// adjustments schema. Appended to the main ensureSchema() run in db.ts
// (idempotent CREATE/ALTER only, applied at every boot under the advisory
// lock, after shop_products since product_id references it). All SQL for
// inventory tracking lives here; the rules live in shop_inventory.ts.

import type { Pool, PoolClient } from 'pg';
import type {
  ShopInventoryAdjustment,
  ShopInventoryDb,
  ShopInventoryListParams,
  ShopInventoryRecord,
  ShopInventoryWriteRow,
} from './shop_inventory';

export const SHOP_INVENTORY_SCHEMA = `
CREATE TABLE IF NOT EXISTS shop_inventory (
  id SERIAL PRIMARY KEY,
  product_id INT UNIQUE NOT NULL REFERENCES shop_products(id) ON DELETE CASCADE,
  quantity_on_hand INT NOT NULL DEFAULT 0,
  quantity_reserved INT NOT NULL DEFAULT 0,
  low_stock_threshold INT NOT NULL DEFAULT 0,
  unlimited BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT shop_inventory_quantity_nonneg CHECK (quantity_on_hand >= 0 AND quantity_reserved >= 0),
  CONSTRAINT shop_inventory_reserved_le_onhand CHECK (quantity_reserved <= quantity_on_hand),
  CONSTRAINT shop_inventory_threshold_nonneg CHECK (low_stock_threshold >= 0)
);

CREATE TABLE IF NOT EXISTS shop_inventory_adjustments (
  id SERIAL PRIMARY KEY,
  product_id INT NOT NULL REFERENCES shop_products(id) ON DELETE CASCADE,
  admin_account_id INT REFERENCES accounts(id) ON DELETE SET NULL,
  delta INT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  quantity_after INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS shop_inventory_adjustments_product
  ON shop_inventory_adjustments(product_id, created_at DESC);
-- Keep-forever: a permanent stock-change audit trail, deliberately not
-- registered with retention_sweep.ts (see server/CLAUDE.md "Hot paths": every
-- unbounded table needs a sweep OR an explicit keep-forever comment at the DDL).
`;

const INVENTORY_COLS = `shop_inventory.id, shop_inventory.product_id,
  shop_products.sku AS product_sku, shop_products.name AS product_name,
  shop_inventory.quantity_on_hand, shop_inventory.quantity_reserved,
  shop_inventory.low_stock_threshold, shop_inventory.unlimited,
  shop_inventory.created_at, shop_inventory.updated_at`;
const INVENTORY_FROM =
  'shop_inventory JOIN shop_products ON shop_products.id = shop_inventory.product_id';

function isoString(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value ?? '');
}

interface InventoryDbRow {
  id: number;
  product_id: number;
  product_sku: string;
  product_name: string;
  quantity_on_hand: number;
  quantity_reserved: number;
  low_stock_threshold: number;
  unlimited: boolean;
  created_at: Date | string;
  updated_at: Date | string;
}

function toRecord(row: InventoryDbRow): ShopInventoryRecord {
  return {
    id: row.id,
    productId: row.product_id,
    productSku: row.product_sku,
    productName: row.product_name,
    quantityOnHand: row.quantity_on_hand,
    quantityReserved: row.quantity_reserved,
    lowStockThreshold: row.low_stock_threshold,
    unlimited: row.unlimited,
    createdAt: isoString(row.created_at),
    updatedAt: isoString(row.updated_at),
  };
}

const SORT_COLUMN: Record<ShopInventoryListParams['sort'], string> = {
  quantity: 'shop_inventory.quantity_on_hand',
  updatedAt: 'shop_inventory.updated_at',
};

/** Insert one append-only adjustment row on the given client (part of the caller's transaction). */
async function insertAdjustment(
  client: PoolClient,
  productId: number,
  quantityAfter: number,
  adjustment: ShopInventoryAdjustment,
): Promise<void> {
  await client.query(
    `INSERT INTO shop_inventory_adjustments
       (product_id, admin_account_id, delta, reason, quantity_after)
     VALUES ($1, $2, $3, $4, $5)`,
    [productId, adjustment.adminAccountId, adjustment.delta, adjustment.reason, quantityAfter],
  );
}

export class PgShopInventoryDb implements ShopInventoryDb {
  constructor(private readonly pool: Pool) {}

  async insertInventory(
    row: ShopInventoryWriteRow,
    adjustment: ShopInventoryAdjustment | null,
  ): Promise<ShopInventoryRecord> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const res = await client.query(
        `INSERT INTO shop_inventory
           (product_id, quantity_on_hand, quantity_reserved, low_stock_threshold, unlimited)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [
          row.productId,
          row.quantityOnHand,
          row.quantityReserved,
          row.lowStockThreshold,
          row.unlimited,
        ],
      );
      const id = res.rows[0].id as number;
      if (adjustment) await insertAdjustment(client, row.productId, row.quantityOnHand, adjustment);
      const full = await client.query(
        `SELECT ${INVENTORY_COLS} FROM ${INVENTORY_FROM} WHERE shop_inventory.id = $1`,
        [id],
      );
      await client.query('COMMIT');
      return toRecord(full.rows[0]);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async getInventory(id: number): Promise<ShopInventoryRecord | null> {
    const res = await this.pool.query(
      `SELECT ${INVENTORY_COLS} FROM ${INVENTORY_FROM} WHERE shop_inventory.id = $1`,
      [id],
    );
    return res.rows[0] ? toRecord(res.rows[0]) : null;
  }

  async getInventoryByProduct(productId: number): Promise<ShopInventoryRecord | null> {
    const res = await this.pool.query(
      `SELECT ${INVENTORY_COLS} FROM ${INVENTORY_FROM} WHERE shop_inventory.product_id = $1`,
      [productId],
    );
    return res.rows[0] ? toRecord(res.rows[0]) : null;
  }

  async listInventory(
    params: ShopInventoryListParams,
  ): Promise<{ rows: ShopInventoryRecord[]; total: number }> {
    const conditions: string[] = [];
    const values: unknown[] = [];
    if (params.q) {
      values.push(`%${params.q}%`);
      conditions.push(
        `(shop_products.name ILIKE $${values.length} OR shop_products.sku ILIKE $${values.length})`,
      );
    }
    if (params.lowStock) {
      conditions.push(
        'shop_inventory.unlimited = false AND shop_inventory.quantity_on_hand <= shop_inventory.low_stock_threshold',
      );
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const orderCol = SORT_COLUMN[params.sort];
    const orderDir = params.dir === 'asc' ? 'ASC' : 'DESC';
    const limitIdx = values.length + 1;
    const offsetIdx = values.length + 2;
    const rowsRes = await this.pool.query(
      `SELECT ${INVENTORY_COLS} FROM ${INVENTORY_FROM} ${where}
        ORDER BY ${orderCol} ${orderDir}, shop_inventory.id ${orderDir}
        LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      [...values, params.limit, (params.page - 1) * params.limit],
    );
    const totalRes = await this.pool.query(
      `SELECT count(*)::int AS n FROM ${INVENTORY_FROM} ${where}`,
      values,
    );
    return {
      rows: rowsRes.rows.map(toRecord),
      total: Number(totalRes.rows[0]?.n ?? 0),
    };
  }

  async updateInventory(
    id: number,
    patch: Partial<ShopInventoryWriteRow>,
    adjustment: ShopInventoryAdjustment | null,
  ): Promise<ShopInventoryRecord | null> {
    const sets: string[] = [];
    const values: unknown[] = [];
    if (patch.quantityOnHand !== undefined) {
      values.push(patch.quantityOnHand);
      sets.push(`quantity_on_hand = $${values.length}`);
    }
    if (patch.quantityReserved !== undefined) {
      values.push(patch.quantityReserved);
      sets.push(`quantity_reserved = $${values.length}`);
    }
    if (patch.lowStockThreshold !== undefined) {
      values.push(patch.lowStockThreshold);
      sets.push(`low_stock_threshold = $${values.length}`);
    }
    if (patch.unlimited !== undefined) {
      values.push(patch.unlimited);
      sets.push(`unlimited = $${values.length}`);
    }
    if (sets.length === 0 && !adjustment) return this.getInventory(id);
    sets.push('updated_at = now()');
    values.push(id);

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const res = await client.query(
        `UPDATE shop_inventory SET ${sets.join(', ')} WHERE id = $${values.length}
         RETURNING product_id, quantity_on_hand`,
        values,
      );
      if ((res.rowCount ?? 0) === 0) {
        await client.query('ROLLBACK');
        return null;
      }
      const { product_id: productId, quantity_on_hand: quantityAfter } = res.rows[0];
      if (adjustment) await insertAdjustment(client, productId, quantityAfter, adjustment);
      const full = await client.query(
        `SELECT ${INVENTORY_COLS} FROM ${INVENTORY_FROM} WHERE shop_inventory.id = $1`,
        [id],
      );
      await client.query('COMMIT');
      return toRecord(full.rows[0]);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async deleteInventory(id: number): Promise<boolean> {
    const res = await this.pool.query('DELETE FROM shop_inventory WHERE id = $1 RETURNING id', [
      id,
    ]);
    return (res.rowCount ?? 0) > 0;
  }
}
