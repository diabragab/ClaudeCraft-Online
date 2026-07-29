# Database

World of ClaudeCraft persists to a single Postgres database (`pg`, pooled via `server/db.ts`).
This document covers how schema changes ship in this repo and gives a full reference for the
shop catalog schema (Phase 1 of the shop backend) and the shop orders schema (Phase 3). For the
rest of the schema (accounts, characters, social, moderation, daily rewards, and so on),
`server/db.ts` and the domain `server/*_db.ts` modules are the source of truth; `server/CLAUDE.md`
is the architectural reference.

## Schema management: no migration tool

There are no migration files. Every table, column, index, and constraint ships as more
idempotent DDL appended to a `SCHEMA` string (the core tables, in `server/db.ts`) or to a
domain-specific `<DOMAIN>_SCHEMA` constant exported from that domain's `*_db.ts` module (for
example `SHOP_CATEGORIES_SCHEMA` in `server/shop_categories_db.ts`). `ensureSchema()`
(`server/db.ts`) applies every one of these, in a fixed order, at every server boot:

1. A dedicated (non-pooled) `pg.Client` connects and opens a transaction with
   `statement_timeout = 0` (schema setup must never be cut off by a query timeout).
2. `SELECT pg_advisory_xact_lock($1)` serializes schema setup across every realm process
   sharing this database (concurrent boots cannot race the DDL).
3. Each schema constant runs in dependency order: core `SCHEMA` first, then every domain schema
   whose tables reference an earlier one (for example the shop catalog: categories, then
   products, since `shop_products.category_id` references `shop_categories`, then inventory,
   since `shop_inventory.product_id` references `shop_products`).
4. The transaction commits.
5. A second, post-commit pass runs any `CREATE INDEX CONCURRENTLY` migrations
   (`server/concurrent_indexes.ts`) under the session form of the same advisory lock, since
   `CONCURRENTLY` cannot run inside a transaction.

Every statement uses `IF NOT EXISTS` / `IF NOT EXISTS ... ADD COLUMN` / guarded `DO $$ ... $$`
blocks so re-running it on an already-up-to-date database is a safe no-op. A schema change
ships as more DDL appended to the existing constant, never a new migration file, and never an
edit to already-shipped DDL (a column or index, once shipped, is only ever added to or
superseded, never silently rewritten).

## The shop catalog schema (Phase 1)

Three tables plus one append-only audit table, applied in this order (`server/db.ts`
`ensureSchema()`, after `USER_ASSETS_SCHEMA`): `SHOP_CATEGORIES_SCHEMA` -> `SHOP_PRODUCTS_SCHEMA`
-> `SHOP_INVENTORY_SCHEMA`.

### `shop_categories`

Defined in `server/shop_categories_db.ts`.

| Column | Type | Notes |
|---|---|---|
| `id` | `SERIAL PRIMARY KEY` | |
| `name` | `TEXT NOT NULL` | |
| `slug` | `TEXT UNIQUE NOT NULL` | URL-safe: `^[a-z0-9]+(-[a-z0-9]+)*$`, checked in `server/shop_categories.ts` |
| `description` | `TEXT NOT NULL DEFAULT ''` | |
| `parent_id` | `INT REFERENCES shop_categories(id) ON DELETE SET NULL` | Self-referential tree; a deleted parent orphans its children to root rather than cascading |
| `sort_order` | `INT NOT NULL DEFAULT 0` | Admin-controlled display order |
| `status` | `TEXT NOT NULL DEFAULT 'active'` | `'active' \| 'archived'` |
| `created_at` / `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

Indexes: `shop_categories_parent` (`parent_id`, since Postgres never auto-indexes the
referencing side of a foreign key) and `shop_categories_status_sort` (`status, sort_order`, for
the default admin list ordering).

### `shop_products`

Defined in `server/shop_products_db.ts`.

| Column | Type | Notes |
|---|---|---|
| `id` | `SERIAL PRIMARY KEY` | |
| `sku` | `TEXT UNIQUE NOT NULL` | |
| `name` | `TEXT NOT NULL` | |
| `slug` | `TEXT UNIQUE NOT NULL` | Same charset as category slugs |
| `description` | `TEXT NOT NULL DEFAULT ''` | |
| `category_id` | `INT REFERENCES shop_categories(id) ON DELETE SET NULL` | Null means uncategorized |
| `price_gold_copper` | `BIGINT` | In-game gold price, smallest unit (copper) |
| `price_claudium` | `INT` | Premium-currency price (see docs/claudium-store.md for what Claudium is) |
| `price_usd_cents` | `INT` | Canonical USD price; required if any crypto rail is enabled |
| `rail_sol` / `rail_usdc` / `rail_woc` | `BOOLEAN NOT NULL DEFAULT false` | Which native crypto rails may quote this product |
| `status` | `TEXT NOT NULL DEFAULT 'draft'` | `'draft' \| 'active' \| 'archived'` |
| `featured` | `BOOLEAN NOT NULL DEFAULT false` | Phase 4 addition (via `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, the table having already shipped in Phase 1); curated by an operator, drives the storefront's "Featured products" section |
| `grant_kind` | `TEXT NOT NULL DEFAULT 'none'` | Phase 5 addition (same `ALTER TABLE ADD COLUMN IF NOT EXISTS` pattern); `'none' \| 'weapon_skin' \| 'item'` — what buying this product with Claudium in-game delivers; `'none'` is every pre-Phase-5 row |
| `grant_item_id` | `TEXT` | Phase 5; a weapon-skin id (`WEAPON_SKINS` key) or a sim `ITEMS` key, required (non-null) unless `grant_kind` is `'none'`; enforced service-side (`server/shop_products.ts`), not by a DB CHECK |
| `grant_quantity` | `INT NOT NULL DEFAULT 1` | Phase 5; how many of `grant_item_id` a `grant_kind: 'item'` purchase mails per unit purchased |
| `created_at` / `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

Constraints:
- `shop_products_price_present`: at least one of the three price columns must be set.
- `shop_products_price_gold_nonneg` / `_claudium_nonneg` / `_usd_nonneg`: no negative prices.
- `shop_products_rails_need_usd`: a crypto rail flag may only be true when `price_usd_cents` is
  set (native rails are quoted from the USD price; defense in depth alongside the identical
  check in `server/shop_products.ts`).

Indexes: `shop_products_category` (`category_id`, FK-referencing-side index),
`shop_products_status_updated` (`status, updated_at DESC`, the default admin list ordering), and
`shop_products_featured` (a partial index on `(status, created_at DESC) WHERE featured = true`,
Phase 4, serving the storefront's featured-products query).

**Pricing is data only in this phase.** Phase 1 ships Products/Categories/Inventory CRUD; it
does not ship a purchase/checkout flow. Actual money movement for the existing Claudium/weapon
skin store is unrelated to these tables and is described in `docs/claudium-store.md`.

### `shop_inventory`

Defined in `server/shop_inventory_db.ts`. One row per tracked product; a product with no row is
"not tracked" (no admin-visible stock number, rather than a fabricated zero).

| Column | Type | Notes |
|---|---|---|
| `id` | `SERIAL PRIMARY KEY` | |
| `product_id` | `INT UNIQUE NOT NULL REFERENCES shop_products(id) ON DELETE CASCADE` | 1:1 with `shop_products` |
| `quantity_on_hand` | `INT NOT NULL DEFAULT 0` | |
| `quantity_reserved` | `INT NOT NULL DEFAULT 0` | Must never exceed `quantity_on_hand` |
| `low_stock_threshold` | `INT NOT NULL DEFAULT 0` | Drives the admin list's low-stock filter |
| `unlimited` | `BOOLEAN NOT NULL DEFAULT false` | An unlimited row is never flagged low-stock regardless of its numbers |
| `created_at` / `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

Constraints: `shop_inventory_quantity_nonneg` (both quantity columns >= 0),
`shop_inventory_reserved_le_onhand` (`quantity_reserved <= quantity_on_hand`),
`shop_inventory_threshold_nonneg`.

### `shop_inventory_adjustments`

An append-only audit trail: every `quantity_on_hand` change (on create, when non-zero; on
update, whenever the value actually changes) writes one row here in the SAME transaction as the
inventory write (`server/shop_inventory_db.ts`), so the ledger can never disagree with the row
it describes.

| Column | Type | Notes |
|---|---|---|
| `id` | `SERIAL PRIMARY KEY` | |
| `product_id` | `INT NOT NULL REFERENCES shop_products(id) ON DELETE CASCADE` | |
| `admin_account_id` | `INT REFERENCES accounts(id) ON DELETE SET NULL` | The operator who made the change; null if the account is later deleted |
| `delta` | `INT NOT NULL` | Signed change (positive = stock added, negative = stock removed) |
| `reason` | `TEXT NOT NULL DEFAULT ''` | Free-text, admin-supplied |
| `quantity_after` | `INT NOT NULL` | The resulting `quantity_on_hand`, for a point-in-time read without replaying deltas |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

Index: `shop_inventory_adjustments_product` (`product_id, created_at DESC`).

**Retention: kept forever, by design.** This table is a permanent audit trail and is
deliberately not registered with the nightly retention sweep (`server/retention_sweep.ts`); the
DDL carries an explicit keep-forever comment per the invariant in `server/CLAUDE.md` ("every
table that grows without bound gets a retention story... or an explicit keep-forever comment").

## The shop orders schema (Phase 3)

Three tables, applied after the catalog schema above (`server/db.ts` `ensureSchema()`, after
`SHOP_INVENTORY_SCHEMA`): `SHOP_ORDERS_SCHEMA`, defined in `server/shop_orders_db.ts`, which
carries all three tables (`shop_orders`, `shop_order_items`, `shop_order_status_history`) in one
constant since they ship together and reference each other.

Orders in this phase are entered by an operator (see `SHOP_SYSTEM.md` for the scope decision):
there is no payment gateway and no customer storefront yet, so every order starts life via the
admin-only create endpoint.

### `shop_orders`

| Column | Type | Notes |
|---|---|---|
| `id` | `SERIAL PRIMARY KEY` | |
| `account_id` | `INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE` | The player the order is for |
| `status` | `TEXT NOT NULL DEFAULT 'pending'` | `'pending' \| 'paid' \| 'fulfilled' \| 'cancelled' \| 'refunded'`; see the state machine below |
| `currency` | `TEXT NOT NULL` | `'gold' \| 'claudium' \| 'usd'`; fixed for the whole order (one of the three `shop_products` price columns) |
| `total_amount` | `BIGINT NOT NULL DEFAULT 0` | Sum of `shop_order_items.line_total`, in `currency`'s smallest unit |
| `note` | `TEXT NOT NULL DEFAULT ''` | Free-text, operator-supplied |
| `created_by_admin_id` | `INT REFERENCES accounts(id) ON DELETE SET NULL` | The operator who created the order; null for a system-created order or a since-deleted admin account |
| `created_at` / `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

Constraints: `shop_orders_status_check`, `shop_orders_currency_check` (closed vocabularies),
`shop_orders_total_nonneg`.

Indexes: `shop_orders_account` (`account_id, created_at DESC`) and `shop_orders_status_created`
(`status, created_at DESC`, the admin list's default filter + ordering).

### `shop_order_items`

One row per distinct product in an order (duplicate `productId` entries in a create request are
merged into one row by `server/shop_orders.ts` before the insert). Product fields are **snapshotted
at order time**: `product_sku` / `product_name` / `unit_price` are copied from `shop_products` when
the order is created and never re-read from it afterward, so a later price change or rename never
rewrites a historical order, and a deleted product still shows what was actually sold.

| Column | Type | Notes |
|---|---|---|
| `id` | `SERIAL PRIMARY KEY` | |
| `order_id` | `INT NOT NULL REFERENCES shop_orders(id) ON DELETE CASCADE` | |
| `product_id` | `INT REFERENCES shop_products(id) ON DELETE SET NULL` | Null once the product is deleted; the snapshot columns below still describe what was ordered |
| `product_sku` / `product_name` | `TEXT NOT NULL` | Snapshotted at order creation |
| `unit_price` | `BIGINT NOT NULL` | Snapshotted price in the order's currency, smallest unit |
| `quantity` | `INT NOT NULL` | `CHECK (quantity > 0)` |
| `line_total` | `BIGINT NOT NULL` | `unit_price * quantity`, stored rather than recomputed |

Constraints: `shop_order_items_quantity_positive`, `shop_order_items_prices_nonneg`.

Indexes: `shop_order_items_order` (`order_id`) and `shop_order_items_product` (`product_id`, both
FK-referencing-side indexes).

### `shop_order_status_history`

An append-only audit trail: every status transition, including the initial `pending` creation
(`from_status IS NULL`), writes one row here in the SAME transaction as the status change
(`server/shop_orders_db.ts`), so the timeline can never disagree with the order it describes.

| Column | Type | Notes |
|---|---|---|
| `id` | `SERIAL PRIMARY KEY` | |
| `order_id` | `INT NOT NULL REFERENCES shop_orders(id) ON DELETE CASCADE` | |
| `from_status` | `TEXT` | Null only for the initial creation row |
| `to_status` | `TEXT NOT NULL` | `CHECK` against the same closed vocabulary as `shop_orders.status` |
| `admin_account_id` | `INT REFERENCES accounts(id) ON DELETE SET NULL` | The operator who made the change |
| `note` | `TEXT NOT NULL DEFAULT ''` | Free-text, operator-supplied per transition |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

Index: `shop_order_status_history_order` (`order_id, created_at`).

**Retention: kept forever, by design.** Same posture as `shop_inventory_adjustments`: a permanent
audit trail, deliberately not registered with the nightly retention sweep, with an explicit
keep-forever comment at the DDL.

### The order status state machine and its stock effect

The only valid transitions (`server/shop_orders.ts` `transitionEffect`; anything else is rejected
with `shop.invalid_status_transition`):

| From | To | Stock effect on `shop_inventory` (per line item, skipped for `unlimited` products) |
|---|---|---|
| (create) | `pending` | Reserve: `quantity_reserved += qty` |
| `pending` | `paid` | Deduct: `quantity_on_hand -= qty; quantity_reserved -= qty` |
| `pending` | `cancelled` | Release: `quantity_reserved -= qty` (on-hand untouched) |
| `paid` | `fulfilled` | None |
| `paid` | `cancelled` | Restore: `quantity_on_hand += qty` |
| `paid` | `refunded` | Restore: `quantity_on_hand += qty` |
| `fulfilled` | `refunded` | Restore: `quantity_on_hand += qty` |

This is the literal mechanism behind "inventory decreases only after a successful purchase": an
order only ever RESERVES stock at creation (via the `quantity_reserved` column Phase 1 added but
left unused); `quantity_on_hand` itself only moves at the `pending -> paid` transition. A product
with no `shop_inventory` row at all is not orderable (`shop.out_of_stock`), even if it would
otherwise be `unlimited`; stock effects for an item whose product was later deleted (`product_id
IS NULL`) are a no-op, since there is no live inventory row left to touch.

## Relationships

```
accounts (existing)
  └─< shop_inventory_adjustments.admin_account_id  (ON DELETE SET NULL)
  └─< shop_orders.account_id                       (ON DELETE CASCADE)
  └─< shop_orders.created_by_admin_id              (ON DELETE SET NULL)
  └─< shop_order_status_history.admin_account_id   (ON DELETE SET NULL)

shop_categories
  └─< shop_categories.parent_id                    (self-referential, ON DELETE SET NULL)
  └─< shop_products.category_id                    (ON DELETE SET NULL)

shop_products
  └─< shop_inventory.product_id                    (ON DELETE CASCADE, UNIQUE: 1:1)
  └─< shop_inventory_adjustments.product_id        (ON DELETE CASCADE)
  └─< shop_order_items.product_id                  (ON DELETE SET NULL)

shop_orders
  └─< shop_order_items.order_id                    (ON DELETE CASCADE)
  └─< shop_order_status_history.order_id           (ON DELETE CASCADE)
```

Deleting a category never deletes its products (they fall back to uncategorized); deleting a
product deletes its inventory row and adjustment history along with it, but leaves any historical
order line items in place (with `product_id` cleared to null, snapshot columns intact). Deleting
an account cascades its orders (and their items/history along with them via `shop_orders`'
own `ON DELETE CASCADE` children); this mirrors how `characters` already cascades from `accounts`.

## Missing tables (explicitly out of scope for Phase 3)

There is still no payment-gateway ledger (Stripe/crypto webhooks, receipts) and no customer-facing
storefront table. Phase 3 is the back-office orders system: an operator creates and manages orders
through the admin API; a customer-facing checkout flow that would create orders itself is a later
phase (see `SHOP_SYSTEM.md`).
