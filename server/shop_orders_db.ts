// Postgres-backed ShopOrdersDb plus the shop_orders / shop_order_items /
// shop_order_status_history schema. Appended to the main ensureSchema() run
// in db.ts (idempotent CREATE/ALTER only, applied at every boot under the
// advisory lock, after shop_products and shop_inventory since orders
// reference both). All SQL for orders lives here, including the direct
// reads/writes against shop_products and shop_inventory that a stock effect
// needs: those two tables' own Db classes (shop_products_db.ts,
// shop_inventory_db.ts) each independently open and commit their own
// transaction, so they cannot be composed into the externally-scoped
// transaction a create-order or status-transition needs. This module never
// calls into either sibling Db class; it reads/writes the same tables with
// its own SQL, the same way shop_inventory_db.ts already joins shop_products
// for display columns without touching PgShopProductsDb. The rules live in
// shop_orders.ts.

import type { Pool, PoolClient } from 'pg';
import type {
  ResolvedOrderItem,
  ShopOrderCreateInput,
  ShopOrderDetail,
  ShopOrderErrorCode,
  ShopOrderItemRecord,
  ShopOrderListParams,
  ShopOrderRecord,
  ShopOrderStatus,
  ShopOrderStatusHistoryRecord,
  ShopOrdersDb,
  StockEffect,
} from './shop_orders';

type ItemRejection = Exclude<
  ShopOrderErrorCode,
  'account_not_found' | 'not_found' | 'invalid_transition'
>;

export const SHOP_ORDERS_SCHEMA = `
CREATE TABLE IF NOT EXISTS shop_orders (
  id SERIAL PRIMARY KEY,
  account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  currency TEXT NOT NULL,
  total_amount BIGINT NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  created_by_admin_id INT REFERENCES accounts(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT shop_orders_status_check CHECK (
    status IN ('pending', 'paid', 'fulfilled', 'cancelled', 'refunded')
  ),
  CONSTRAINT shop_orders_currency_check CHECK (currency IN ('gold', 'claudium', 'usd')),
  CONSTRAINT shop_orders_total_nonneg CHECK (total_amount >= 0)
);
CREATE INDEX IF NOT EXISTS shop_orders_account ON shop_orders(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS shop_orders_status_created ON shop_orders(status, created_at DESC);

CREATE TABLE IF NOT EXISTS shop_order_items (
  id SERIAL PRIMARY KEY,
  order_id INT NOT NULL REFERENCES shop_orders(id) ON DELETE CASCADE,
  product_id INT REFERENCES shop_products(id) ON DELETE SET NULL,
  product_sku TEXT NOT NULL,
  product_name TEXT NOT NULL,
  unit_price BIGINT NOT NULL,
  quantity INT NOT NULL,
  line_total BIGINT NOT NULL,
  CONSTRAINT shop_order_items_quantity_positive CHECK (quantity > 0),
  CONSTRAINT shop_order_items_prices_nonneg CHECK (unit_price >= 0 AND line_total >= 0)
);
CREATE INDEX IF NOT EXISTS shop_order_items_order ON shop_order_items(order_id);
CREATE INDEX IF NOT EXISTS shop_order_items_product ON shop_order_items(product_id);

CREATE TABLE IF NOT EXISTS shop_order_status_history (
  id SERIAL PRIMARY KEY,
  order_id INT NOT NULL REFERENCES shop_orders(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT NOT NULL,
  admin_account_id INT REFERENCES accounts(id) ON DELETE SET NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT shop_order_status_history_to_check CHECK (
    to_status IN ('pending', 'paid', 'fulfilled', 'cancelled', 'refunded')
  )
);
CREATE INDEX IF NOT EXISTS shop_order_status_history_order
  ON shop_order_status_history(order_id, created_at);
-- Keep-forever: a permanent order audit trail, the same posture as
-- shop_inventory_adjustments (deliberately not registered with
-- retention_sweep.ts; see server/CLAUDE.md "Hot paths").
`;

function isoString(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value ?? '');
}

// pg returns BIGINT columns as strings to avoid silent precision loss; every
// value here only ever holds a JS-safe-integer this module wrote itself, so
// converting back is safe (mirrors shop_products_db.ts's toGoldCopper).
function toAmount(value: string | number): number {
  return typeof value === 'string' ? Number(value) : value;
}

interface OrderDbRow {
  id: number;
  account_id: number;
  account_username: string;
  status: ShopOrderStatus;
  currency: ShopOrderRecord['currency'];
  total_amount: string | number;
  note: string;
  created_by_admin_id: number | null;
  created_at: Date | string;
  updated_at: Date | string;
}

function toOrderRecord(row: OrderDbRow): ShopOrderRecord {
  return {
    id: row.id,
    accountId: row.account_id,
    accountUsername: row.account_username,
    status: row.status,
    currency: row.currency,
    totalAmount: toAmount(row.total_amount),
    note: row.note,
    createdByAdminId: row.created_by_admin_id,
    createdAt: isoString(row.created_at),
    updatedAt: isoString(row.updated_at),
  };
}

interface ItemDbRow {
  id: number;
  product_id: number | null;
  product_sku: string;
  product_name: string;
  unit_price: string | number;
  quantity: number;
  line_total: string | number;
}

function toItemRecord(row: ItemDbRow): ShopOrderItemRecord {
  return {
    id: row.id,
    productId: row.product_id,
    productSku: row.product_sku,
    productName: row.product_name,
    unitPrice: toAmount(row.unit_price),
    quantity: row.quantity,
    lineTotal: toAmount(row.line_total),
  };
}

interface HistoryDbRow {
  id: number;
  from_status: ShopOrderStatus | null;
  to_status: ShopOrderStatus;
  admin_account_id: number | null;
  note: string;
  created_at: Date | string;
}

function toHistoryRecord(row: HistoryDbRow): ShopOrderStatusHistoryRecord {
  return {
    id: row.id,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    adminAccountId: row.admin_account_id,
    note: row.note,
    createdAt: isoString(row.created_at),
  };
}

const ORDER_COLS = `shop_orders.id, shop_orders.account_id, accounts.username AS account_username,
  shop_orders.status, shop_orders.currency, shop_orders.total_amount, shop_orders.note,
  shop_orders.created_by_admin_id, shop_orders.created_at, shop_orders.updated_at`;
const ORDER_FROM = 'shop_orders JOIN accounts ON accounts.id = shop_orders.account_id';

const SORT_COLUMN: Record<ShopOrderListParams['sort'], string> = {
  createdAt: 'shop_orders.created_at',
  updatedAt: 'shop_orders.updated_at',
  totalAmount: 'shop_orders.total_amount',
};

interface ProductPricingRow {
  status: string;
  price_gold_copper: string | number | null;
  price_claudium: number | null;
  price_usd_cents: number | null;
  sku: string;
  name: string;
}

interface InventoryRow {
  quantity_on_hand: number;
  quantity_reserved: number;
  unlimited: boolean;
}

function priceForCurrency(
  row: ProductPricingRow,
  currency: ShopOrderCreateInput['currency'],
): number | null {
  if (currency === 'gold')
    return row.price_gold_copper === null ? null : toAmount(row.price_gold_copper);
  if (currency === 'claudium') return row.price_claudium;
  return row.price_usd_cents;
}

/** Apply a stock effect to one product's inventory row, locked FOR UPDATE; a no-op if untracked or unlimited. */
async function applyStockEffect(
  client: PoolClient,
  productId: number,
  quantity: number,
  effect: StockEffect,
): Promise<void> {
  if (effect === 'none') return;
  const res = await client.query<InventoryRow>(
    `SELECT quantity_on_hand, quantity_reserved, unlimited FROM shop_inventory
      WHERE product_id = $1 FOR UPDATE`,
    [productId],
  );
  const inventory = res.rows[0];
  if (!inventory || inventory.unlimited) return;
  if (effect === 'reserve') {
    await client.query(
      `UPDATE shop_inventory SET quantity_reserved = quantity_reserved + $2, updated_at = now()
        WHERE product_id = $1`,
      [productId, quantity],
    );
  } else if (effect === 'deductReservation') {
    await client.query(
      `UPDATE shop_inventory
          SET quantity_on_hand = quantity_on_hand - $2,
              quantity_reserved = quantity_reserved - $2,
              updated_at = now()
        WHERE product_id = $1`,
      [productId, quantity],
    );
  } else if (effect === 'releaseReservation') {
    await client.query(
      `UPDATE shop_inventory SET quantity_reserved = quantity_reserved - $2, updated_at = now()
        WHERE product_id = $1`,
      [productId, quantity],
    );
  } else if (effect === 'restore') {
    await client.query(
      `UPDATE shop_inventory SET quantity_on_hand = quantity_on_hand + $2, updated_at = now()
        WHERE product_id = $1`,
      [productId, quantity],
    );
  }
}

async function fetchDetail(
  client: Pick<PoolClient, 'query'>,
  id: number,
): Promise<ShopOrderDetail | null> {
  const orderRes = await client.query<OrderDbRow>(
    `SELECT ${ORDER_COLS} FROM ${ORDER_FROM} WHERE shop_orders.id = $1`,
    [id],
  );
  if (!orderRes.rows[0]) return null;
  const itemsRes = await client.query<ItemDbRow>(
    `SELECT id, product_id, product_sku, product_name, unit_price, quantity, line_total
       FROM shop_order_items WHERE order_id = $1 ORDER BY id ASC`,
    [id],
  );
  const historyRes = await client.query<HistoryDbRow>(
    `SELECT id, from_status, to_status, admin_account_id, note, created_at
       FROM shop_order_status_history WHERE order_id = $1 ORDER BY created_at ASC, id ASC`,
    [id],
  );
  return {
    ...toOrderRecord(orderRes.rows[0]),
    items: itemsRes.rows.map(toItemRecord),
    history: historyRes.rows.map(toHistoryRecord),
  };
}

export class PgShopOrdersDb implements ShopOrdersDb {
  constructor(private readonly pool: Pool) {}

  async createOrder(
    input: ShopOrderCreateInput,
    account: { id: number; username: string },
    createdByAdminId: number | null,
  ): Promise<
    { ok: true; order: ShopOrderDetail } | { ok: false; error: ItemRejection; productId?: number }
  > {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const resolved: ResolvedOrderItem[] = [];
      for (const item of input.items) {
        const productRes = await client.query<ProductPricingRow>(
          `SELECT status, price_gold_copper, price_claudium, price_usd_cents, sku, name
             FROM shop_products WHERE id = $1 FOR UPDATE`,
          [item.productId],
        );
        const product = productRes.rows[0];
        if (!product) {
          await client.query('ROLLBACK');
          return { ok: false, error: 'product_not_found', productId: item.productId };
        }
        if (product.status !== 'active') {
          await client.query('ROLLBACK');
          return { ok: false, error: 'product_not_active', productId: item.productId };
        }
        const unitPrice = priceForCurrency(product, input.currency);
        if (unitPrice === null) {
          await client.query('ROLLBACK');
          return { ok: false, error: 'price_not_set', productId: item.productId };
        }
        const inventoryRes = await client.query<InventoryRow>(
          `SELECT quantity_on_hand, quantity_reserved, unlimited FROM shop_inventory
            WHERE product_id = $1 FOR UPDATE`,
          [item.productId],
        );
        const inventory = inventoryRes.rows[0];
        if (!inventory) {
          await client.query('ROLLBACK');
          return { ok: false, error: 'not_tracked', productId: item.productId };
        }
        if (!inventory.unlimited) {
          const available = inventory.quantity_on_hand - inventory.quantity_reserved;
          if (available < item.quantity) {
            await client.query('ROLLBACK');
            return { ok: false, error: 'insufficient_stock', productId: item.productId };
          }
        }
        resolved.push({
          productId: item.productId,
          productSku: product.sku,
          productName: product.name,
          unitPrice,
          quantity: item.quantity,
          lineTotal: unitPrice * item.quantity,
        });
      }

      const totalAmount = resolved.reduce((sum, item) => sum + item.lineTotal, 0);
      const orderRes = await client.query<{ id: number }>(
        `INSERT INTO shop_orders (account_id, status, currency, total_amount, note, created_by_admin_id)
         VALUES ($1, 'pending', $2, $3, $4, $5)
         RETURNING id`,
        [account.id, input.currency, totalAmount, input.note, createdByAdminId],
      );
      const orderId = orderRes.rows[0].id;

      for (const item of resolved) {
        await client.query(
          `INSERT INTO shop_order_items
             (order_id, product_id, product_sku, product_name, unit_price, quantity, line_total)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            orderId,
            item.productId,
            item.productSku,
            item.productName,
            item.unitPrice,
            item.quantity,
            item.lineTotal,
          ],
        );
        await applyStockEffect(client, item.productId, item.quantity, 'reserve');
      }

      await client.query(
        `INSERT INTO shop_order_status_history (order_id, from_status, to_status, admin_account_id, note)
         VALUES ($1, NULL, 'pending', $2, $3)`,
        [orderId, createdByAdminId, input.note],
      );

      const detail = await fetchDetail(client, orderId);
      await client.query('COMMIT');
      return { ok: true, order: detail as ShopOrderDetail };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  getOrder(id: number): Promise<ShopOrderDetail | null> {
    return fetchDetail(this.pool, id);
  }

  async listOrders(
    params: ShopOrderListParams,
  ): Promise<{ rows: ShopOrderRecord[]; total: number }> {
    const conditions: string[] = [];
    const values: unknown[] = [];
    if (params.q) {
      values.push(`%${params.q}%`);
      conditions.push(
        `(accounts.username ILIKE $${values.length} OR shop_orders.note ILIKE $${values.length})`,
      );
    }
    if (params.status !== undefined) {
      values.push(params.status);
      conditions.push(`shop_orders.status = $${values.length}`);
    }
    if (params.accountId !== undefined) {
      values.push(params.accountId);
      conditions.push(`shop_orders.account_id = $${values.length}`);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const orderCol = SORT_COLUMN[params.sort];
    const orderDir = params.dir === 'asc' ? 'ASC' : 'DESC';
    const limitIdx = values.length + 1;
    const offsetIdx = values.length + 2;
    const rowsRes = await this.pool.query<OrderDbRow>(
      `SELECT ${ORDER_COLS} FROM ${ORDER_FROM} ${where}
        ORDER BY ${orderCol} ${orderDir}, shop_orders.id ${orderDir}
        LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      [...values, params.limit, (params.page - 1) * params.limit],
    );
    const totalRes = await this.pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM ${ORDER_FROM} ${where}`,
      values,
    );
    return {
      rows: rowsRes.rows.map(toOrderRecord),
      total: Number(totalRes.rows[0]?.n ?? 0),
    };
  }

  async applyTransition(
    orderId: number,
    from: ShopOrderStatus,
    to: ShopOrderStatus,
    effect: StockEffect,
    adminAccountId: number | null,
    note: string,
  ): Promise<ShopOrderDetail | null> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const statusRes = await client.query<{ status: ShopOrderStatus }>(
        'SELECT status FROM shop_orders WHERE id = $1 FOR UPDATE',
        [orderId],
      );
      const current = statusRes.rows[0];
      // A status mismatch here means the order moved between the service's
      // read and this write (a concurrent transition); treat it the same as
      // "order gone" rather than silently applying a stale transition twice.
      if (!current || current.status !== from) {
        await client.query('ROLLBACK');
        return null;
      }

      const itemsRes = await client.query<{ product_id: number | null; quantity: number }>(
        'SELECT product_id, quantity FROM shop_order_items WHERE order_id = $1',
        [orderId],
      );
      for (const item of itemsRes.rows) {
        if (item.product_id === null) continue;
        await applyStockEffect(client, item.product_id, item.quantity, effect);
      }

      await client.query('UPDATE shop_orders SET status = $2, updated_at = now() WHERE id = $1', [
        orderId,
        to,
      ]);
      await client.query(
        `INSERT INTO shop_order_status_history (order_id, from_status, to_status, admin_account_id, note)
         VALUES ($1, $2, $3, $4, $5)`,
        [orderId, from, to, adminAccountId, note],
      );

      const detail = await fetchDetail(client, orderId);
      await client.query('COMMIT');
      return detail;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }
}
