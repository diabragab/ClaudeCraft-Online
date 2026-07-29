# Changelog

Notable changes to World of ClaudeCraft. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/); per-version player-facing release notes live in
`docs/release-notes/`. This file tracks development-facing changes between releases.

## Unreleased

### Added

- **Shop backend foundation (Phase 1): Categories, Products, Inventory.** A new admin-only CRUD
  backend for the shop catalog, unrelated to the existing Claudium/weapon-skin store (whose
  pricing and purchase ledger remain owned by the external economy service; see
  `docs/claudium-store.md`). This phase ships the catalog and stock-tracking data model only; no
  checkout/purchase flow and no admin dashboard UI yet.
  - Three tables plus one append-only stock-adjustment audit table (`shop_categories`,
    `shop_products`, `shop_inventory`, `shop_inventory_adjustments`), applied as idempotent boot
    DDL like every other table in this repo (`server/db.ts`, no migration tool). See
    `DATABASE.md` for the full schema reference.
  - Full CRUD REST APIs under `/admin/api/shop/{categories,products,inventory}`, each with
    pagination, search, filtering, and sorting on its list endpoint. Gated by two new admin
    permissions, `shop.read` and `shop.manage` (`server/admin_permissions.ts`,
    `server/admin_routes.ts`), granted to the `admin`/`superadmin` roles. See `API.md` for the
    full endpoint reference.
  - New server modules: `server/shop_categories.ts` / `_db.ts` / `_routes.ts`,
    `server/shop_products.ts` / `_db.ts` / `_routes.ts`, `server/shop_inventory.ts` / `_db.ts` /
    `_routes.ts`, `server/shop_slug.ts` (the shared category/product slug-format check), and
    `server/http/admin_envelope.ts` (the shared admin success-envelope writer these new route
    modules use).
  - `server/admin.ts`'s `requireAdmin` gate is now exported so sibling admin-surface route
    modules (like these) mount the exact same instance rather than a parallel one, keeping the
    registry-wide `tests/server/http/ownership_coverage.test.ts` sweep meaningful for every
    admin route, not just `server/admin.ts`'s own.
  - Two new stable error codes, `shop.not_found` and `shop.invalid_input`
    (`server/http/error_codes.ts`), with the usual client-side i18n catalog entries and their
    required non-Latin fills (zh_CN, zh_TW, ja_JP, ko_KR, ru_RU).
  - Test coverage: service-level unit tests for all three domains' business rules
    (`tests/shop_categories.test.ts`, `tests/shop_products.test.ts`,
    `tests/shop_inventory.test.ts`) and route-level tests driving the real middleware onion
    (`tests/server/shop_categories_routes.test.ts`, `tests/server/shop_products_routes.test.ts`,
    `tests/server/shop_inventory_routes.test.ts`).
  - Documentation: this repo's first `DATABASE.md` and `API.md`.

- **Shop backend admin UI (Phase 2): Categories, Products, Inventory pages.** The admin dashboard
  (`src/admin/`) now has a "Shop" navigation section with three pages that talk to the Phase 1
  endpoints above; no new server-side logic in this phase.
  - `src/admin/pages/ShopCategories.svelte`, `ShopProducts.svelte`, `ShopInventory.svelte`: each
    lists its resource with search, filtering, sorting, and pagination (reusing the existing
    `Pager`/`Panel`/`PageHeader`/`Badge`/`ModalDialog` components), an inline create form, an
    edit modal, and a delete confirmation. Every write is hidden behind `auth.can('shop.manage')`
    (presentation only; the server re-checks every call).
  - Two new `AdminPage` route ids per domain wired into `navigation.ts`, `pages.ts`, and
    `App.svelte`'s `PAGE_COMPONENTS` map; a new nav section, `shop`, gated on `shop.read`.
  - New response types in `src/admin/types.ts` (`ShopCategoriesData`, `ShopProductsData`,
    `ShopInventoryData`, and their row types), reusing the existing generic `Paginated<T>`.
  - ~100 new English i18n keys in `src/admin/i18n.en.ts` (English-only; PR-tier admin i18n does
    not require non-Latin fills, unlike the game client's M16 rule). Four new reverse-mapped
    error entries in `ADMIN_ERROR_KEYS` (`src/admin/i18n.ts`) for the Phase 1 backend's stable
    error codes (`shop.not_found`, `shop.invalid_input`, `validation.failed`, `db.conflict`),
    since this is the first admin surface to answer with a machine code instead of legacy
    English prose.
  - Test coverage: three new Testing-Library component test files
    (`tests/admin/shop_categories.test.ts`, `shop_products.test.ts`, `shop_inventory.test.ts`)
    covering list rendering, create, edit, delete, and permission-gating.
  - Verification: `svelte-check` and `tsc --noEmit` clean, the full `tests/admin/` suite green,
    and the admin Vite bundle confirmed to mount with zero console errors. Full authenticated
    click-through in a browser was not possible in this environment (no local Postgres/Docker to
    run the backend admin login depends on).

- **Shop orders (Phase 3): back-office order entry, status management, and stock reservation.**
  Orders over the Phase 1/2 catalog. Scope decision (see `SHOP_SYSTEM.md`): there is still no
  payment gateway and no customer-facing storefront, so every order in this phase is created and
  managed by an operator through the admin API; `POST /admin/api/shop/orders` is the only way an
  order currently enters the system.
  - Three new tables (`shop_orders`, `shop_order_items`, `shop_order_status_history`, the last an
    append-only audit trail like `shop_inventory_adjustments`), applied as idempotent boot DDL
    (`server/shop_orders_db.ts`'s `SHOP_ORDERS_SCHEMA`, wired into `server/db.ts` after the
    catalog schema). See `DATABASE.md` for the full schema reference.
  - The order state machine (`pending -> paid -> fulfilled`, with `cancelled`/`refunded` off
    `pending`/`paid`/`fulfilled` as documented): stock is RESERVED
    (`shop_inventory.quantity_reserved`, the column Phase 1 added but left unused) at order
    creation and only actually DEDUCTED from `quantity_on_hand` at the `pending -> paid`
    transition, which is the literal mechanism behind "inventory decreases only after a
    successful purchase." A product with no inventory row is not orderable, and every quantity
    check is race-safe (`SELECT ... FOR UPDATE` inside one transaction per operation).
  - Full REST API under `/admin/api/shop/orders`: paginated/searchable/filterable/sortable list,
    create, get (with items + status-history timeline), and three status-change endpoints
    (generic `.../status`, plus `.../cancel` and `.../refund` shorthands), reusing the existing
    `shop.read`/`shop.manage` permissions. See `API.md` for the full endpoint reference.
  - Two new stable error codes, `shop.out_of_stock` and `shop.invalid_status_transition`
    (`server/http/error_codes.ts`), with the usual client-side i18n catalog entries, their
    required non-Latin fills, and the admin dashboard's reverse-mapped error keys.
  - New server modules: `server/shop_orders.ts` / `_db.ts` / `_routes.ts`. A new `array()`
    schema combinator (`server/http/schema.ts`) for validating an order's line items.
  - Admin UI: a new "Orders" page (`src/admin/pages/ShopOrders.svelte`, list + a compact
    back-office "new order" form) and an Order Details page
    (`src/admin/pages/ShopOrderDetail.svelte`: summary, items, status-change actions gated on
    `shop.manage`, and the status-history timeline), reached via a detail route outside the nav
    tree (`{ page: 'shop-order-detail', id }` in `src/admin/navigation.ts`, the same shape as the
    existing IP-associations route) plus a shared `OrderStatusBadge.svelte` component.
  - Test coverage: service-level unit tests for the state machine and stock effects
    (`tests/shop_orders.test.ts`, using an in-memory fake that mirrors the real transactional SQL)
    and route-level tests driving the real middleware onion
    (`tests/server/shop_orders_routes.test.ts`), plus two new admin component test files
    (`tests/admin/shop_orders.test.ts`, `tests/admin/shop_order_detail.test.ts`).
  - Verification: `svelte-check` and `tsc --noEmit` clean, the full shop test suite green
    (service + route + admin component tests), and the admin Vite bundle confirmed to mount with
    zero console errors. Full authenticated click-through was not possible in this environment
    (no local Postgres/Docker), the same limitation Phase 2 recorded.

- **Public storefront (Phase 4).** A new player-facing SPA at `/store` (`store.html` ->
  `src/store/`) built entirely on the Phase 1-3 backend: browse, cart, checkout, and order
  history, reusing the exact same catalog/order services the admin dashboard uses. See
  `SHOP_SYSTEM.md`'s "Phase 4 scope decisions" for the full reasoning behind the choices below.
  - New public/player REST surface, `/api/shop/*`, separate from the staff-only
    `/admin/api/shop/*` surface: `server/shop_storefront_catalog_routes.ts` (anonymous,
    active-only category/product browsing, `GET /api/shop/{categories,products}` +
    `:slug` detail, each response including a computed `availability` and, for products, the
    resolved `category`) and `server/shop_storefront_orders_routes.ts` (`requireAccount`-gated
    "my orders": `POST/GET /api/shop/orders`, `GET /api/shop/orders/:id`, the latter
    ownership-checked via the existing `requireOwned` BOLA seam, `ownerScope: 'account'`, the
    same one `server/characters.ts` uses). Every handler on both is a thin wrapper: zero catalog
    or order business logic is duplicated, only reused
    (`ShopCategoriesService`/`ShopProductsService`/`ShopInventoryService`/`ShopOrdersService`);
    an order's `accountId` is always the authenticated caller's own, never client-supplied.
  - Schema: a `featured BOOLEAN` column on `shop_products` (idempotent `ALTER TABLE ... ADD
    COLUMN IF NOT EXISTS`, a partial index for the featured-products query), plus
    `getProductBySlug`/`getCategoryBySlug` read methods on the existing Db/Service pairs (for the
    storefront's pretty-URL detail routes). A new pure module, `server/shop_storefront.ts`
    (product availability + price-for-currency derivations, display-only; the authoritative
    check stays exactly where Phase 3 put it).
  - Storefront SPA (`src/store/`, plain TypeScript/DOM, no framework - Svelte stays scoped to
    `src/admin/` only): a history-based router (`router.ts`, `routes.ts`, mirroring
    `src/guide/`'s own small router), a page registry (`pages/index.ts`) with one module per page
    (home, categories, products listing/search, product detail, cart, checkout, confirmation,
    order history, order detail, not-found), and a shared REST client (`api.ts`) that reads/writes
    the SAME `woc_session` localStorage key the game client and the homepage account portal
    already use, so a signed-in player is recognized automatically with no separate storefront
    login.
  - Shopping cart (`cart.ts`, pure; `cart_storage.ts`, the localStorage adapter;
    `cart_controller.ts`, the stateful live-cart wrapper the pages subscribe to): client-side and
    scoped to one currency at a time (adding a product priced in a different currency than the
    cart already holds is rejected, not mixed); each line item snapshots its product's
    slug/name/price at add-to-cart time, mirroring `shop_order_items`' own snapshot design.
    "Inventory validation" is advisory client-side (the catalog's computed `availability`); the
    authoritative check is the unmodified Phase 3 `ShopOrdersService.createOrder` transaction,
    re-run unconditionally at checkout.
  - Checkout creates a `pending` order via the new player-scoped endpoint and shows a plain-
    language confirmation that the order is PLACED, not paid (no payment gateway exists yet;
    `pending -> paid` is still the admin's manual "Mark paid" action from Phase 3).
  - i18n: a new `store.*` catalog domain (`src/ui/i18n.catalog/store.ts`, ~120 keys) with the
    required non-Latin fills (zh_CN/zh_TW/ja_JP/ko_KR/ru_RU) for every wordy new key, the same
    M16 rule every other game-client catalog domain follows.
  - Build/serve wiring: a new Vite entry (`store: store.html`) and the matching SPA deep-link
    fallback in both `vite.config.ts` (dev/preview) and `server/main.ts` `serveStatic`
    (production), mirroring `guide.html`/`/wiki`'s existing pattern.
  - Test coverage: route-level tests for both new backend modules
    (`tests/server/shop_storefront_catalog_routes.test.ts`,
    `shop_storefront_orders_routes.test.ts`) plus a pure-module test for the availability/pricing
    helpers (`tests/shop_storefront.test.ts`); on the frontend, pure-core tests (cart, routing,
    formatting), jsdom component tests for every storefront page, and an integration test
    chaining the real page modules through the full browse-to-confirmation flow with one shared
    cart controller (`tests/store/`).
  - Verification: `tsc --noEmit` and `npm run build` both clean (the `/store` bundle: ~26 KB
    gzip ~7 KB), the repo-wide guard sweeps (BOLA ownership coverage, surface-inventory
    freshness, i18n completeness) extended to cover the new routes, and a dev-server smoke check
    confirmed the SPA mounts with zero console errors, client-side routing and the deep-link
    fallback both work, and the mobile viewport renders cleanly. Full authenticated
    click-through (signing in as a real player and placing a real order) was not possible in
    this environment (no local Postgres/Docker), the same limitation every prior phase recorded.

- **In-game Shop (Phase 5): the Treasure Chest icon's Store tab now runs on the Shop System.**
  Same chest icon, same `#daily-rewards-window`, same Store/Daily Rewards tabs; only the Store
  tab's content changed, from the old bespoke Season 1 Armory grid to a live view of the general
  `shop_products` catalog, priced and paid for in Claudium, delivered immediately on purchase.
  See `SHOP_SYSTEM.md`'s "Phase 5 scope decisions" for the full reasoning.
  - Weapon skins migrated into the catalog, not retired: a new boot-time seed
    (`server/shop_armory_seed.ts`, idempotent `ON CONFLICT DO NOTHING`, wired into
    `ensureSchema()`) mirrors every `WEAPON_SKIN_LIST` entry into an "Armory" `shop_products`
    row (`grantKind: 'weapon_skin'`, Season 1 tier pricing from `docs/claudium-store.md`), so
    they sell through the one general purchase flow instead of a second bespoke one. The
    in-game grid still renders them with their full existing localization/art/rarity treatment
    (`localizeWeaponSkin`, `armorySkinArt`) by resolving `grantItemId` back through
    `WEAPON_SKINS` client-side; owning one still uses the existing Armory inspect/apply/detach
    modal unchanged.
  - Schema: `shop_products` gained `grantKind` (`'none' | 'weapon_skin' | 'item'`),
    `grantItemId`, `grantQuantity` (idempotent `ALTER TABLE`), so a product can declare what it
    actually delivers; `'none'` is every pre-Phase-5 product (unaffected, no automated
    delivery). Admin Products page gained matching fields.
  - New player-scoped checkout, `POST /api/shop/claudium/purchase`
    (`server/shop_storefront_claudium_routes.ts`), backed by a new orchestration module
    (`server/shop_claudium_checkout.ts`) that sequences EXISTING pieces rather than duplicating
    them: `ShopOrdersService.createOrder` (Phase 3, unchanged) reserves stock as an ordinary
    pending order, `claudiumSpend` (`server/claudium_proxy.ts`, unchanged) charges Claudium with
    a per-order idempotency key, then the order is marked `paid` and delivered. If the charge
    fails the pending order is simply cancelled and no money moves; this ordering keeps the one
    real failure mode (charged, nothing delivered) to the small in-process delivery step after
    an already-successful, already-recorded payment.
  - Delivery reuses existing grant paths, not new ones: a `weapon_skin` product calls
    `grantWeaponSkinForShop` (`server/claudium.ts`), the exact account-cosmetics grant the old
    Armory purchase used, already live-game-wired via the existing `configureClaudiumRuntime`.
    A generic `item` product mails `grantQuantity` of `grantItemId` straight into the buyer's
    live mailbox (`PostOffice.mailShopItem`, mirroring the existing `mailHeroicMarks` pattern;
    a new `GameServer.mailShopItemToCharacter` + `configureShopCheckoutRuntime` hook), since a
    Claudium purchase only ever happens from an active session.
  - Client wiring stays inside the existing seams: a new `src/net/shop_client.ts` (thin fetch
    wrapper, same role and shape as `economy_sdk.ts`) plus a new `src/ui/woc_general_store_view.ts`
    pure view-core (owned/applied/affordable/purchasable per product, weapon-skin-aware) feed a
    rewritten `daily_rewards_window.ts` store-tab painter through a new `ShopHooks`/`attachShop`
    injection on `Hud`, mirroring `ClaudiumHooks`/`attachClaudium` exactly. Category filter and
    search reuse the existing `/api/shop/products` query params (server-side, not reimplemented
    client-side).
  - i18n: new `hudChrome.wocStore.*` keys for the general catalog (search, category filter,
    "no results", uncategorized) plus five new `apiError.shop.*` codes
    (`insufficient_claudium`/`price_changed`/`claudium_unavailable`/`not_deliverable`/
    `character_not_found`), all with their non-Latin fills.
  - Test coverage: unit tests for the checkout orchestration covering both grant kinds and
    every failure path (`tests/shop_claudium_checkout.test.ts`), a route-level test for the new
    endpoint (`tests/server/shop_storefront_claudium_routes.test.ts`), a pure-core test for the
    new store view (`tests/woc_general_store_view.test.ts`), an Armory-seed idempotency test
    (`tests/shop_armory_seed.test.ts`), and the existing `daily_rewards_window`/store contract
    tests rewritten for the new general-catalog wiring.
  - Verification: `tsc --noEmit`, `svelte-check` (admin), and `npm run build` all clean; the
    full Vitest suite green, including the repo-wide guard sweeps (error-code snapshot,
    `apiError.*` parity, i18n completeness, HTTP surface inventory/completeness/content-type
    classification) extended to cover the new route and codes. Full authenticated click-through
    (signing in as a real player, buying a product with Claudium in-game) was not possible in
    this environment (no local Postgres/Docker), the same limitation every prior phase recorded.
