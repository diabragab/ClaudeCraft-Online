# API

World of ClaudeCraft's REST surface is built on the in-house pipeline under `server/http/`
(`server/http/CLAUDE.md` is the architectural reference: `RouteDef` modules, a middleware onion,
typed schema validation, and a stable machine error-code catalog). This document covers the
authentication model shared by every admin-surface endpoint, then gives a full reference for the
shop catalog admin API (Phase 1: Categories, Products, Inventory), the shop orders admin API
(Phase 3: Orders), and the public storefront API (Phase 4: anonymous catalog browsing plus a
player's own orders).

For the rest of the API (player-facing `/api/*`, OAuth, internal ops), see `server/CLAUDE.md`
and the individual domain route modules; the full endpoint inventory is enumerated in
`tests/server/http/surface_inventory.ts`.

## Admin authentication and authorization

Every endpoint in this document lives under `/admin/api/shop/*` and is gated identically to the
rest of the admin dashboard's API (`server/admin.ts`):

1. **Login** (`POST /admin/api/login`, not part of this document) issues a 64-hex bearer token
   to an account holding at least one staff role.
2. **Every other admin route** requires `Authorization: Bearer <token>` and passes through
   `requireAdmin` (`server/admin.ts`, shared by every admin-surface route, including these):
   the token must resolve to a full-scope, active session on a staff account (fail-closed 401
   `{ success: false, data: null, error: "admin authentication required" }` on any failure), and
   the account's roles must include the route's declared permission (`shop.read` for a read,
   `shop.manage` for a write; see `server/admin_permissions.ts` and `server/admin_routes.ts`),
   or the request 403s `{ success: false, data: null, error: "you do not have permission to do
   this" }`.
3. **Response envelope.** Every response, success or error, is `{ success: boolean, data: T |
   null, error: string | null }` (never RFC 9457 `problem+json`, which is the player-facing
   `/api/*` surface's envelope instead).

`shop.read` is granted to the `admin` and `superadmin` roles only (not `moderator` or `viewer`
by default in this phase; catalog/pricing data is treated the same as bot-detector internals
and ops/usage telemetry: sensitive, not part of the generic read bundle). `shop.manage` follows
the same admin/superadmin-only posture.

## Conventions shared by all three domains

- **Pagination.** Every list endpoint accepts `page` (default `1`) and `limit` (default `20`,
  max `100`) query parameters and returns `{ rows: T[], total: number, page: number, limit:
  number }`.
- **Search.** `q` (default `''`, max 64 chars) does a case-insensitive substring match against
  the domain's name-like fields.
- **Sorting.** `sort` and `dir` (`'asc' | 'desc'`) select the order; each domain's valid `sort`
  values are listed below.
- **Update is `POST`, not `PUT`; delete is a `POST .../delete` suffix, not `DELETE`.** The shared
  `requireAdmin` gate only accepts `GET`/`POST` (matching every other admin route in this repo),
  so a resource's mutation routes both use `POST`, distinguished by path.
- **IDs referencing another resource travel as plain non-negative integers, never `null`.** `0`
  is the "none" sentinel (a category's `parentId`, a product's `categoryId`); see the field
  tables below. Every id-shaped path parameter (`:id`) must be a positive integer, or the
  request 422s before any handler code runs.
- **Prices travel as strings.** Each of a product's three price fields is a non-negative integer
  string, or `''` meaning "no price set" (and, on an update, "clear this price"). See Products
  below for why.
- **Errors.** A validation-shape failure (wrong type, out-of-range, missing required field) is a
  422 with the standard `validation.failed` code. A domain-rule rejection (an invalid slug, a
  missing referenced row, a business-rule conflict) is either a 404 `shop.not_found` or a 400
  `shop.invalid_input`, per the tables below; a slug/SKU collision is a 409 `db.conflict` (the
  Postgres unique constraint, not a hand-written check). Orders (Phase 3) add two more codes:
  400 `shop.out_of_stock` (an untracked or insufficiently stocked line item) and 400
  `shop.invalid_status_transition` (a status change the state machine does not allow from the
  order's current status).

---

## Categories: `/admin/api/shop/categories`

Business rules: `server/shop_categories.ts`. Routes: `server/shop_categories_routes.ts`.

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET | `/admin/api/shop/categories` | `shop.read` | Paginated, searchable, filterable, sortable list |
| POST | `/admin/api/shop/categories` | `shop.manage` | Create |
| GET | `/admin/api/shop/categories/:id` | `shop.read` | Read one |
| POST | `/admin/api/shop/categories/:id` | `shop.manage` | Update (partial) |
| POST | `/admin/api/shop/categories/:id/delete` | `shop.manage` | Delete (products fall back to uncategorized) |

**List query params** (beyond the shared ones): `parentId` (integer, `0` = root-only filter,
omitted = no filter), `status` (`'active' | 'archived'`). Sort values: `name`, `sortOrder`,
`createdAt`.

**Category fields:**

| Field | Type | Notes |
|---|---|---|
| `id` | number | |
| `name` | string | 1-120 chars |
| `slug` | string | 1-80 chars, `^[a-z0-9]+(-[a-z0-9]+)*$` |
| `description` | string | Max 2000 chars, default `''` |
| `parentId` | number \| null | `0` on the wire means none/root; the response carries `null` |
| `sortOrder` | number | Default `0` |
| `status` | `'active' \| 'archived'` | Default `'active'` |
| `createdAt` / `updatedAt` | string (ISO 8601) | |

**Domain rejections** (400 `shop.invalid_input` unless noted): `invalid_slug`, `parent_not_found`
(the given `parentId` does not exist), `self_parent` (a category cannot parent itself),
`parent_cycle` (the reassignment would close a cycle in the tree); a missing `:id` on update is
404 `shop.not_found`.

---

## Products: `/admin/api/shop/products`

Business rules: `server/shop_products.ts`. Routes: `server/shop_products_routes.ts`.

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET | `/admin/api/shop/products` | `shop.read` | Paginated, searchable, filterable, sortable list |
| POST | `/admin/api/shop/products` | `shop.manage` | Create |
| GET | `/admin/api/shop/products/:id` | `shop.read` | Read one |
| POST | `/admin/api/shop/products/:id` | `shop.manage` | Update (partial) |
| POST | `/admin/api/shop/products/:id/delete` | `shop.manage` | Delete (its inventory row cascades) |

**List query params:** `categoryId` (integer, `0` = uncategorized-only filter), `status`
(`'draft' | 'active' | 'archived'`). Sort values: `name`, `createdAt`, `updatedAt`.

**Product fields:**

| Field | Type | Notes |
|---|---|---|
| `id` | number | |
| `sku` | string | 1-64 chars, unique |
| `name` | string | 1-120 chars |
| `slug` | string | 1-80 chars, unique, same charset as categories |
| `description` | string | Max 2000 chars, default `''` |
| `categoryId` | number \| null | `0` on the wire means uncategorized; the response carries `null` |
| `priceGoldCopper` | string in, number \| null out | Wire string: non-negative integer or `''` |
| `priceClaudium` | string in, number \| null out | Same convention |
| `priceUsdCents` | string in, number \| null out | Same convention; required if any rail is enabled |
| `railSol` / `railUsdc` / `railWoc` | boolean | Default `false` |
| `status` | `'draft' \| 'active' \| 'archived'` | Default `'draft'` |
| `createdAt` / `updatedAt` | string (ISO 8601) | |

At least one price field must resolve to non-null, or the request is rejected (`no_price`); this
is re-checked on every update against the MERGED (existing + incoming) state, so clearing the
only remaining price is rejected the same way creating a priceless product would be.

**Domain rejections** (400 `shop.invalid_input` unless noted): `invalid_slug`, `invalid_price`
(a price string that is not a valid non-negative integer), `no_price`, `rails_need_usd_price` (a
rail is/would be enabled with no USD price to quote it from); `category_not_found` and a missing
`:id` on update are both 404 `shop.not_found`.

---

## Inventory: `/admin/api/shop/inventory`

Business rules: `server/shop_inventory.ts`. Routes: `server/shop_inventory_routes.ts`. One row
per tracked product; a product with no row is simply not tracked (not shown as zero stock).

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET | `/admin/api/shop/inventory` | `shop.read` | Paginated, searchable, filterable, sortable list |
| POST | `/admin/api/shop/inventory` | `shop.manage` | Start tracking a product |
| GET | `/admin/api/shop/inventory/:id` | `shop.read` | Read one |
| POST | `/admin/api/shop/inventory/:id` | `shop.manage` | Adjust stock / thresholds / the unlimited flag |
| POST | `/admin/api/shop/inventory/:id/delete` | `shop.manage` | Stop tracking (deletes the row) |

**List query params:** `lowStock` (boolean, default `false`; when true, only rows where
`!unlimited && quantityOnHand <= lowStockThreshold`). Sort values: `quantity`, `updatedAt`.

**Inventory fields:**

| Field | Type | Notes |
|---|---|---|
| `id` | number | |
| `productId` | number | |
| `productSku` / `productName` | string | Joined from the product, read-only |
| `quantityOnHand` | number | >= 0 |
| `quantityReserved` | number | >= 0, always <= `quantityOnHand` |
| `lowStockThreshold` | number | >= 0, default `0` |
| `unlimited` | boolean | An unlimited row is never flagged low-stock regardless of its numbers |
| `createdAt` / `updatedAt` | string (ISO 8601) | |

**Create body:** `productId` (required), `quantityOnHand` (default `0`), `lowStockThreshold`
(default `0`), `unlimited` (default `false`), `reason` (optional; recorded as the initial-stock
adjustment when `quantityOnHand` is non-zero).

**Update body:** `quantityOnHand`, `lowStockThreshold`, `unlimited` (all optional; an omitted
field is left unchanged), `reason` (optional, attached to the adjustment record if
`quantityOnHand` actually changes).

**Stock-change audit trail.** Every `quantityOnHand` change (on create with a non-zero opening
count, or on update whenever the value changes) writes one row to `shop_inventory_adjustments`
in the same transaction as the write itself: `delta`, `reason`, the acting admin's account id,
and the resulting `quantityOnHand`. See `DATABASE.md` for the table shape. There is no read
endpoint over this ledger yet in Phase 1.

**Domain rejections** (400 `shop.invalid_input` unless noted): `already_tracked` (the product
already has an inventory row), `invalid_quantity` (a negative quantity, or a reserved count that
would exceed on-hand); `product_not_found` and a missing `:id` on update are both 404
`shop.not_found`.

---

## Orders: `/admin/api/shop/orders`

Business rules + state machine: `server/shop_orders.ts`. SQL (including the transactional stock
effects): `server/shop_orders_db.ts`. Routes: `server/shop_orders_routes.ts`.

**Scope: back-office order entry, not a customer storefront.** There is no payment gateway and no
player-facing checkout yet (see `SHOP_SYSTEM.md`), so every order in this phase is created and
managed by an operator; `POST /admin/api/shop/orders` is the only way an order currently enters
the system. `shop.read`/`shop.manage` are reused as-is (no new permission).

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET | `/admin/api/shop/orders` | `shop.read` | Paginated, searchable, filterable, sortable list |
| POST | `/admin/api/shop/orders` | `shop.manage` | Create an order (reserves stock for its items) |
| GET | `/admin/api/shop/orders/:id` | `shop.read` | Read one, with its items and status-history timeline |
| POST | `/admin/api/shop/orders/:id/status` | `shop.manage` | Move to any status the state machine allows next |
| POST | `/admin/api/shop/orders/:id/cancel` | `shop.manage` | Cancel (a `pending -> cancelled` or `paid -> cancelled` shorthand for `.../status`) |
| POST | `/admin/api/shop/orders/:id/refund` | `shop.manage` | Refund (a `paid -> refunded` or `fulfilled -> refunded` shorthand) |

**List query params** (beyond the shared ones): `status` (one of the five order statuses),
`accountId` (integer). `q` matches against the account's username or the order's `note`. Sort
values: `createdAt` (default), `updatedAt`, `totalAmount`.

**Order fields** (the shape returned by the list endpoint; the detail endpoint below adds `items`
and `history`):

| Field | Type | Notes |
|---|---|---|
| `id` | number | |
| `accountId` | number | |
| `accountUsername` | string | Joined from `accounts`, read-only |
| `status` | `'pending' \| 'paid' \| 'fulfilled' \| 'cancelled' \| 'refunded'` | See the state machine in `DATABASE.md` |
| `currency` | `'gold' \| 'claudium' \| 'usd'` | Fixed for the whole order |
| `totalAmount` | number | Sum of the items' `lineTotal`, smallest unit of `currency` |
| `note` | string | Max 500 chars, default `''` |
| `createdByAdminId` | number \| null | The creating operator; null if since deleted |
| `createdAt` / `updatedAt` | string (ISO 8601) | |

**Create body:** `accountId` (required, must reference an existing account), `currency`
(required), `items` (required, 1-50 entries, each `{ productId: number, quantity: number (>= 1)
}`; a `productId` repeated across entries is merged into one line by summing its quantities),
`note` (optional, max 500 chars, default `''`).

Every item is validated before ANYTHING is written (the whole create is one Postgres
transaction): the product must exist, be `status: 'active'`, carry a non-null price in the
order's `currency`, and have a `shop_inventory` row covering the requested quantity (`unlimited`
products skip the quantity check; a product with no inventory row at all is not orderable). On
success the order is created as `pending` and every line item's quantity is RESERVED
(`shop_inventory.quantity_reserved`), never yet deducted from `quantityOnHand` (see the state
machine in `DATABASE.md` for why).

**Order detail** (`GET /admin/api/shop/orders/:id`) adds:

| Field | Type | Notes |
|---|---|---|
| `items[]` | array | `{ id, productId (null if the product was deleted), productSku, productName, unitPrice, quantity, lineTotal }`, snapshotted at order creation |
| `history[]` | array | `{ id, fromStatus (null for the creation row), toStatus, adminAccountId, note, createdAt }`, oldest first |

**Status change bodies:**
- `POST .../status`: `{ status: <one of the five statuses>, note?: string }`.
- `POST .../cancel` and `POST .../refund`: `{ note?: string }` (the target status is implied by
  the route).

Every status-change endpoint re-reads the order's CURRENT status server-side and validates the
transition against the state machine before applying it (a stale client-side status can never
force an invalid transition); every transition, valid or not, is attempted atomically (order
status + inventory effect + one `shop_order_status_history` row, all in one transaction).

**Domain rejections:**
- 404 `shop.not_found`: `account_not_found` (create), `product_not_found` (create), `not_found`
  (any endpoint referencing a missing `:id`, or an order that vanished between a status read and
  the write, treated as a benign concurrent-transition race).
- 400 `shop.invalid_input`: `empty_items`, `product_not_active`, `price_not_set`.
- 400 `shop.out_of_stock`: `not_tracked` (no inventory row), `insufficient_stock`.
- 400 `shop.invalid_status_transition`: `invalid_transition` (the requested status is not reachable
  from the order's current status; see the state machine in `DATABASE.md`).

---

# Public storefront + in-game Shop API (Phases 4-5)

Every endpoint above lives under `/admin/api/*` and is staff-only. Both the public storefront
(`/store`, see `SHOP_SYSTEM.md`) and the in-game Shop (the Treasure Chest icon's Store tab) are
**player-facing surfaces under `/api/shop/*`**: anonymous catalog browsing, a player's own
orders, and (Phase 5) a Claudium checkout. Every route module
(`server/shop_storefront_catalog_routes.ts`, `server/shop_storefront_orders_routes.ts`,
`server/shop_storefront_claudium_routes.ts`) is a thin wrapper over the EXACT SAME services the
admin surface above uses
(`ShopCategoriesService`/`ShopProductsService`/`ShopInventoryService`/`ShopOrdersService`); no
business logic is duplicated here.

**Envelope.** Unlike the admin surface's `{ success, data, error }` envelope, this surface uses
the standard `/api/*` convention: a bare JSON value on success (200), and RFC 9457
`application/problem+json` on error (`{ type, title, status, detail, instance, code }`), the same
shape every other `/api/*` route in this repo uses.

**Authentication.** The catalog-browsing endpoints are fully anonymous (no bearer token). The
order endpoints require the SAME player account bearer token the game client and the homepage
account portal already use (`Authorization: Bearer <token>`, `server/http/middleware/
require_account.ts`); there is no separate storefront login, and a request's `accountId` is
ALWAYS the authenticated caller's own, resolved server-side (`ctxAccountId(ctx)`) and never
accepted from the request body.

## Catalog: `/api/shop/categories`, `/api/shop/products`

Business rules: reused verbatim from `server/shop_categories.ts` / `server/shop_products.ts` /
`server/shop_inventory.ts` (Phase 1). Routes: `server/shop_storefront_catalog_routes.ts`.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/shop/categories` | none | Paginated, searchable, sortable list, **`status: 'active'` forced server-side** |
| GET | `/api/shop/categories/:slug` | none | One category by slug; 404 if missing or not active |
| GET | `/api/shop/products` | none | Paginated, searchable, filterable (`categoryId`, `featured`), sortable list, **active-only** |
| GET | `/api/shop/products/:slug` | none | One product by slug; 404 if missing or not active |

A draft or archived category/product is NEVER exposed on this surface, regardless of what a
client requests: the `status` query parameter admin uses to filter is not accepted here at all,
and every read forces `status: 'active'` in the underlying service call.

Every product response (list rows and the detail read) adds two fields the admin catalog
response does not carry:

| Field | Type | Notes |
|---|---|---|
| `availability` | `'unlimited' \| 'in_stock' \| 'low_stock' \| 'out_of_stock' \| 'unavailable'` | Computed display-only status from the product's `shop_inventory` row (`server/shop_storefront.ts`'s `productAvailability`); `'unavailable'` means untracked (no inventory row), the same "never orderable" condition Phase 3's order creation enforces |
| `category` | category object \| `null` | Product detail only; the resolved parent category (or `null` if uncategorized), for a breadcrumb |

`featured` (boolean, Phase 4 addition to `shop_products`) drives the storefront home page's
"Featured products" section; set it from the admin Products page. List sort values for products:
`name`, `createdAt` (default, for "New arrivals"), `updatedAt`.

**Rate limiting.** Every catalog read shares the same per-IP public-read budget the deeds rarity
read and the character-sheet/search routes already use (`publicReadRateLimited`,
`server/ratelimit.ts`, 60/minute) and answers 429 the same way.

**Domain rejections:** 404 `shop.not_found` for a missing or non-active slug (both cases, so a
draft product's existence is never revealed to an anonymous caller).

## My orders: `/api/shop/orders`

Business rules: the EXACT SAME `ShopOrdersService` Phase 3's admin orders API uses. Routes:
`server/shop_storefront_orders_routes.ts`. This is the player-facing create path
`SHOP_SYSTEM.md`'s Phase 3 scope note called for: `POST /admin/api/shop/orders` stays
operator-only; this is the separately-permissioned player path.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/shop/orders` | bearer (active/full) | Create an order as the authenticated caller |
| GET | `/api/shop/orders` | bearer (read or full) | The caller's own order history, paginated/filterable/sortable |
| GET | `/api/shop/orders/:id` | bearer (read or full) | One of the caller's OWN orders; 404 (not 403) on any other order, indistinguishable from a missing id (anti-enumeration, `server/http/middleware/require_owned.ts`, the same seam `server/characters.ts` uses) |

**Create body:** `currency`, `items` (1-50 entries, `{ productId, quantity }`, duplicate
`productId`s merged), `note` (optional). No `accountId` field exists on this surface's schema at
all; the order is always created for the caller. Every other validation rule, the state machine,
and the stock reservation are byte-identical to the admin `POST /admin/api/shop/orders` documented
above, because it is the same `ShopOrdersService.createOrder` call.

**List query params:** `page`, `limit`, `status`, `sort` (`createdAt` default, `updatedAt`,
`totalAmount`), `dir`. There is no `accountId` filter param (it is always the caller) and no `q`
search on this surface.

There is no status-change endpoint here: a player cannot cancel, refund, or otherwise transition
their own order in this phase (only the admin surface can). This is a stated Phase 4 gap, not an
oversight; see `TASKS.md`.

**Domain rejections:** identical codes to the admin orders API (`shop.not_found`,
`shop.invalid_input`, `shop.out_of_stock`), since rejections flow through the same
`ShopOrdersService` result type.

## In-game Shop checkout: `/api/shop/claudium/purchase`

Phase 5. The one route the Treasure Chest icon's Store tab calls to buy something: pays with
Claudium (the same server-authoritative currency the old Armory purchase used) and delivers
immediately. Routes: `server/shop_storefront_claudium_routes.ts`; orchestration:
`server/shop_claudium_checkout.ts`. Reuses `ShopOrdersService.createOrder` (stock reservation)
and `claudiumSpend` (`server/claudium_proxy.ts`, the external economy service call) verbatim;
no pricing, stock, or currency logic is duplicated here.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/shop/claudium/purchase` | bearer (active/full) | Buy one product with Claudium; the order is created, charged, marked `paid`, and delivered in one call |

**Body:** `productId` (required), `characterId` (required — the buyer's own live character;
server-verified via `getCharacter(accountId, characterId)`, the same ownership read
`server/characters.ts`'s owner-gated routes use), `quantity` (optional, default 1).

**Response (200):** `{ order: <order detail, same shape as GET /api/shop/orders/:id>, balance:
number | null }`. `balance` is the caller's Claudium balance immediately after the charge.

**Sequencing (why a failure never charges without delivering).** The order is created as an
ordinary `pending` order FIRST (reserving stock, no money moved yet); only then is Claudium
charged, with a per-order deterministic idempotency key (`shop-order-<id>`) so a retried request
never double-spends; only on a successful charge is the order marked `paid` and the product
delivered. If the charge fails for any reason, the pending order is cancelled (its stock
reservation released) and nothing is delivered.

**Delivery.** What happens depends on the product's `grantKind` (Products admin page):
`weapon_skin` grants the account-wide cosmetic (`grantWeaponSkinForShop`, the same grant the old
Armory purchase used); `item` mails `grantQuantity` of `grantItemId` into the buyer's live
mailbox. A product with `grantKind: 'none'` is rejected before any order is created
(`shop.not_deliverable`) — this route only sells products with a configured delivery.

**Domain rejections:**

| Code | HTTP | Meaning |
|---|---|---|
| `shop.not_found` | 404 | Product does not exist |
| `shop.character_not_found` | 404 | `characterId` is missing or is not the caller's own |
| `shop.not_deliverable` | 400 | Product's `grantKind` is `'none'` |
| `shop.out_of_stock` | 400 | Insufficient stock (tracked product) or not tracked at all |
| `shop.insufficient_claudium` | 402 | Caller's Claudium balance is below the product's price |
| `shop.price_changed` | 409 | The economy service rejected the expected cost (price moved) |
| `shop.claudium_unavailable` | 503 | The economy service is off or unreachable |
| `shop.invalid_input` | 400 | Malformed request body |
