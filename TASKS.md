# Shop System: tasks

Phase-by-phase status for the Shop System build-out. See `PROJECT_CONTEXT.md` for the "why", and
`SHOP_SYSTEM.md`/`DATABASE.md`/`API.md` for the architecture/schema/endpoint reference.

## Phase 1: Shop Backend Foundation — done

- [x] Schema: `shop_categories`, `shop_products`, `shop_inventory`, `shop_inventory_adjustments`
      (`server/shop_categories_db.ts`, `shop_products_db.ts`, `shop_inventory_db.ts`).
- [x] Services + validation, zero SQL outside `*_db.ts` (`server/shop_categories.ts`,
      `shop_products.ts`, `shop_inventory.ts`).
- [x] Full CRUD REST APIs with pagination/search/filter/sort
      (`server/shop_categories_routes.ts`, `shop_products_routes.ts`, `shop_inventory_routes.ts`).
- [x] Admin auth (`requireAdmin`, shared with every other admin route) + two new permissions
      (`shop.read`, `shop.manage`).
- [x] Error codes (`shop.not_found`, `shop.invalid_input`) + client i18n parity (game-client
      catalog + admin dashboard reverse-map).
- [x] Service-level + route-level tests for all three domains.
- [x] `DATABASE.md`, `API.md`, `CHANGELOG.md`.

## Phase 2: Admin Panel UI — done

- [x] `src/admin/pages/ShopCategories.svelte`, `ShopProducts.svelte`, `ShopInventory.svelte`:
      list + search/filter/sort/pagination + inline create + modal edit + delete confirm.
- [x] New "Shop" nav section (`src/admin/pages/pages.ts`), wired into `App.svelte`.
- [x] Response types (`src/admin/types.ts`), ~100 new English i18n keys
      (`src/admin/i18n.en.ts`).
- [x] Svelte component tests for all three pages.
- [x] `CHANGELOG.md` updated.

## Phase 3: Orders & Purchase System — done

Database:
- [x] `shop_orders`, `shop_order_items`, `shop_order_status_history` (`server/shop_orders_db.ts`
      `SHOP_ORDERS_SCHEMA`), proper FK relations, applied as idempotent boot DDL (no migration
      tool in this repo — see `DATABASE.md`'s "Schema management" section for why "migrations" in
      the original brief means appended DDL here, not migration files).

Backend:
- [x] Create Order API (`POST /admin/api/shop/orders`).
- [x] Get Order (`GET /admin/api/shop/orders/:id`, with items + status-history timeline).
- [x] List Orders (`GET /admin/api/shop/orders`, paginated/searchable/filterable/sortable).
- [x] Update Order Status (`POST .../status`, generic transition endpoint).
- [x] Cancel Order (`POST .../cancel`).
- [x] Refund support (`POST .../refund`; the state machine supports `paid -> refunded` and
      `fulfilled -> refunded`).
- [x] Validation (schema-shape via `server/http/schema.ts`'s new `array()` combinator, plus
      domain rules in `server/shop_orders.ts`).
- [x] Transactions (every create/status-change is one Postgres transaction;
      `server/shop_orders_db.ts`).
- [x] Stock reservation/deduction (`shop_inventory.quantity_reserved`, reserved at creation,
      deducted from `quantity_on_hand` only at `pending -> paid`).
- [x] Proper error handling (`shop.not_found`, `shop.invalid_input`, plus two new codes:
      `shop.out_of_stock`, `shop.invalid_status_transition`).

Admin Panel:
- [x] Orders page (`src/admin/pages/ShopOrders.svelte`).
- [x] Order Details page (`src/admin/pages/ShopOrderDetail.svelte`).
- [x] Status management (action buttons gated on `shop.manage`, scoped to the transitions the
      state machine actually allows from the order's current status).
- [x] Search (by account username or note).
- [x] Filters (status, account id).
- [x] Pagination.
- [x] Order timeline/history (the status-history panel on the Order Details page).

Business Rules:
- [x] Inventory decreases only after a successful purchase (`pending -> paid`, not at creation).
- [x] Prevent purchasing unavailable products (inactive status, no price in the order's currency,
      or no inventory row at all).
- [x] Prevent negative inventory (`SELECT ... FOR UPDATE` stock check inside the create
      transaction).
- [x] Keep all operations transactional.

Testing:
- [x] Unit tests: `tests/shop_orders.test.ts` (state machine + stock effects via an in-memory
      fake mirroring the real transactional SQL).
- [x] Integration/route tests: `tests/server/shop_orders_routes.test.ts` (real middleware onion,
      auth/permission gating, error-code mapping).
- [x] Verify all APIs: every endpoint covered by the route-level tests above.
- [x] Verify Admin UI: `tests/admin/shop_orders.test.ts`, `tests/admin/shop_order_detail.test.ts`
      (list/create/filter, status actions per current status, permission gating), plus
      `svelte-check`/`tsc --noEmit` clean and a zero-console-error dev-server mount check. Full
      authenticated click-through was not possible in this environment (no local Postgres/Docker
      to run the backend admin login depends on) — the same limitation Phase 2 recorded.

Documentation:
- [x] `DATABASE.md` (Phase 3 schema + state-machine section).
- [x] `API.md` (Orders endpoint reference).
- [x] `PROJECT_CONTEXT.md` (created).
- [x] `SHOP_SYSTEM.md` (created).
- [x] `TASKS.md` (this file, created).
- [x] `CHANGELOG.md` (Phase 3 entry appended).

## Phase 4: Public Storefront — done

Public Store:
- [x] Home page (`src/store/pages/home.ts`): hero, featured products, new arrivals, category
      tiles.
- [x] Categories (`src/store/pages/categories.ts`): full category list.
- [x] Product listing (`src/store/pages/products.ts`): also backs the category-scoped listing
      (`/store/categories/:slug`) via one shared module.
- [x] Product details (`src/store/pages/product_detail.ts`): price(s), a currency picker when a
      product carries more than one, availability, add-to-cart.
- [x] Featured products (`shop_products.featured`, a new Phase 4 column, surfaced via the
      existing Products list endpoint's `featured` filter; manageable from the admin Products
      page).
- [x] New products (the existing product list's `sort: 'createdAt', dir: 'desc'`, no new field
      needed).
- [x] Search (`q` on the products list, debounced).
- [x] Filters (`categoryId`, `featured`).
- [x] Sorting (name / newest / last updated).
- [x] Pagination (prev/next + page-of-N, `store/dom.ts`'s shared `paginationHtml`).

Shopping Cart (`src/store/cart.ts` + `cart_storage.ts` + `cart_controller.ts`):
- [x] Add to cart (`addItem`; merges a repeated add, locks the cart to one currency).
- [x] Remove from cart (`removeItem`).
- [x] Update quantity (`updateQuantity`; a zero/negative quantity removes the line).
- [x] Persist cart (`localStorage`, key `woc_store_cart`; survives a reload and a fresh
      `CartController` instance).
- [x] Inventory validation (advisory client-side via the catalog's computed `availability`; the
      AUTHORITATIVE check is the unchanged Phase 3 `ShopOrdersService.createOrder` transaction,
      re-run unconditionally at checkout).

Checkout (`src/store/pages/checkout.ts`, `confirmation.ts`):
- [x] Checkout page.
- [x] Order review (line items + total, from the live cart).
- [x] Purchase confirmation (`store/pages/confirmation.ts`; explicitly says the order is PLACED
      and pending, not paid — no gateway exists).
- [x] Uses the existing Orders APIs: `ShopOrdersService.createOrder`, via the new player-scoped
      `POST /api/shop/orders` wrapper (the admin `POST /admin/api/shop/orders` stays
      operator-only, per the Phase 3 scope decision).
- [x] No payment gateway implemented.

User Area:
- [x] Order history (`src/store/pages/orders.ts`, `GET /api/shop/orders`, scoped to the caller).
- [x] Order details (`src/store/pages/order_detail.ts`, `GET /api/shop/orders/:id`,
      ownership-checked via `requireOwned`).
- [x] Current order status (status + the full status-history timeline on the order detail page).

UX:
- [x] Loading states (a shared skeleton, `store/dom.ts`'s `loadingHtml`).
- [x] Empty states (per-page, distinct copy: empty cart, no orders, no search results, ...).
- [x] Error handling (a shared retry-capable error state; network/API failures never blank the
      page).
- [x] Responsive layout (`src/store/styles.css`; a `max-width: 700px` stacked header, a
      `pointer: coarse` 16px input floor and 40px touch targets).
- [x] Accessibility (skip link, landmark `<header>`/`<main>`/`<nav>`, labeled form controls,
      `:focus-visible` rings, `aria-live` status/error regions, `prefers-reduced-motion`
      handling).

Testing:
- [x] Component tests: `tests/store/pages/*.test.ts` (jsdom), one file per page, covering
      loading/loaded/empty/error states and every interactive control (add-to-cart, remove,
      quantity update, search debounce, category resolution).
- [x] Integration tests: `tests/store/customer_flow_integration.test.ts` chains the REAL page
      modules (product detail -> cart -> checkout -> confirmation) through ONE shared
      `CartController`, mocking only the network boundary.
- [x] Verify every customer flow: browse (home/categories/products/search/sort/pagination),
      product detail + add to cart, cart review + quantity/remove, checkout + order placement,
      confirmation, and order history/detail — each covered by the tests above.
- [x] Backend: `tests/server/shop_storefront_catalog_routes.test.ts`,
      `tests/server/shop_storefront_orders_routes.test.ts` (route-level, FakeDb pattern),
      `tests/shop_storefront.test.ts` (the pure availability/pricing module), plus the repo-wide
      guard sweeps (ownership coverage, surface inventory, i18n completeness) extended to cover
      the new routes.
- [x] `tsc --noEmit` and `npm run build` both clean (the `/store` bundle: ~26 KB gzip ~7 KB); a
      dev-server smoke check confirmed the SPA mounts with zero console errors, client-side
      routing and the deep-link fallback both work, and the mobile viewport renders without
      errors. Full authenticated click-through (browse as a real signed-in player, place a real
      order) was not possible in this environment (no local Postgres/Docker) — the same
      limitation every prior phase recorded.

Documentation:
- [x] `PROJECT_CONTEXT.md` (Phase 4 status).
- [x] `API.md` (the new public storefront API section).
- [x] `SHOP_SYSTEM.md` (the four Phase 4 scope decisions + their consequences).
- [x] `TASKS.md` (this file).
- [x] `CHANGELOG.md` (Phase 4 entry appended).
- [x] `DATABASE.md` (the `featured` column + its partial index, added to the existing
      `shop_products` reference; not on Phase 4's explicit doc list, but left stale would have
      made that table wrong).

## Phase 5: In-Game Shop (Treasure Chest icon) — done

Scope: keep the existing Treasure Chest icon, `#daily-rewards-window`, and Store/Daily Rewards
tabs unchanged; replace only the Store tab's content, from the old bespoke Season 1 Armory grid
to a live view of the general Shop System catalog, Claudium-only, with immediate delivery. See
`SHOP_SYSTEM.md`'s "Phase 5 scope decisions".

Schema + Armory migration:
- [x] `shop_products` gained `grantKind` (`'none' | 'weapon_skin' | 'item'`), `grantItemId`,
      `grantQuantity` (idempotent `ALTER TABLE`; `server/shop_products_db.ts`).
- [x] Boot-time Armory seed (`server/shop_armory_seed.ts`, wired into `ensureSchema()`):
      idempotently mirrors every `WEAPON_SKIN_LIST` entry into a `shop_products` row under a
      new "Armory" category, `grantKind: 'weapon_skin'`, Season 1 tier pricing from
      `docs/claudium-store.md`. Never overwrites a row an admin has since edited.
- [x] Admin Products page: grant-kind/item-id/quantity fields (`src/admin/pages/ShopProducts.svelte`).

Backend (Claudium checkout + delivery):
- [x] `POST /api/shop/claudium/purchase` (`server/shop_storefront_claudium_routes.ts`):
      `requireAccount({scope:'active'})`, inline character-ownership check (`getCharacter`,
      no `:id` param so no `requireOwned` loader), maps `ClaudiumCheckoutErrorCode` to stable
      `shop.*` HttpErrors.
- [x] Checkout orchestration (`server/shop_claudium_checkout.ts`): reserve stock via the
      unmodified `ShopOrdersService.createOrder`, charge via the unmodified `claudiumSpend`
      (a per-order deterministic idempotency key), mark `paid`, then deliver; a failed charge
      cancels the pending order and moves no money.
- [x] Delivery reuses existing grant paths: `weapon_skin` calls `grantWeaponSkinForShop`
      (`server/claudium.ts`, the same account-cosmetics grant the old Armory purchase used,
      already live-game-wired); `item` mails `grantQuantity` of `grantItemId` to the buyer's
      live character (`PostOffice.mailShopItem`, mirroring `mailHeroicMarks`;
      `GameServer.mailShopItemToCharacter` + a new `configureShopCheckoutRuntime` hook).
- [x] New error codes (`shop.insufficient_claudium`, `.price_changed`, `.claudium_unavailable`,
      `.not_deliverable`, `.character_not_found`) + i18n parity.

Client:
- [x] `src/net/shop_client.ts`: thin fetch wrapper (catalog list, Claudium purchase), same role
      as `economy_sdk.ts`.
- [x] `src/ui/woc_general_store_view.ts`: pure view-core (owned/applied/affordable/purchasable
      per product, weapon-skin-aware via `WEAPON_SKINS` lookup).
- [x] `daily_rewards_window.ts` Store tab rewritten onto the general catalog: search + category
      filter (server-side, reusing the existing `/api/shop/products` query params), a product
      grid, buy-now + confirm-dialog flow; the existing Armory inspect/apply/detach modal is
      reused as-is for owned weapon-skin products.
- [x] `Hud.attachShop(hooks)` / `ShopHooks` (mirrors `attachClaudium`/`ClaudiumHooks`); wired in
      `main.ts` alongside the existing Claudium wiring, online-only.

Testing:
- [x] `tests/shop_claudium_checkout.test.ts`: both grant kinds, every failure path (not found,
      not deliverable, out of stock, insufficient balance, price changed, service unavailable).
- [x] `tests/server/shop_storefront_claudium_routes.test.ts`: auth gating, character-ownership
      404, full error-code -> HTTP-status mapping.
- [x] `tests/woc_general_store_view.test.ts`: the pure view-core.
- [x] `tests/shop_armory_seed.test.ts`: idempotency, one row per skin, unique skus.
- [x] `tests/daily_rewards_store_behavior.test.ts` and `tests/woc_store_window_contract.test.ts`
      rewritten for the general-catalog wiring (former Armory-only pins updated or replaced).
- [x] `tsc --noEmit`, `svelte-check` (admin), `npm run build`, and the full Vitest suite (incl.
      the error-code snapshot, `apiError.*` parity, i18n completeness, and HTTP surface
      inventory/completeness/content-type guard sweeps) all clean. Full authenticated
      click-through (buy a product with Claudium in-game) was not possible in this environment
      (no local Postgres/Docker) — the same limitation every prior phase recorded.

Documentation:
- [x] `PROJECT_CONTEXT.md`, `API.md`, `SHOP_SYSTEM.md`, `TASKS.md` (this file), `CHANGELOG.md`.

## Explicitly deferred to a future phase

- [ ] Payment gateway integration (Stripe, crypto rail settlement) driving the web storefront's
      `pending -> paid` transition automatically via webhook, instead of the admin "Mark paid"
      button. Not needed for the in-game Shop, which already pays synchronously via Claudium.
- [ ] Player self-service order cancellation/refund, an order-confirmation email or receipt, and
      an idempotency key on the web storefront's `POST /api/shop/orders` (a double-submit there
      currently creates two orders; the in-game Claudium checkout already has its own
      deterministic idempotency key, see Phase 5 above).
- [ ] A read endpoint over `shop_inventory_adjustments` (the stock-change audit ledger already
      recorded in Phase 1 has no admin-facing view yet).
- [ ] `grantKind: 'item'` has no real catalog content yet (only weapon skins are seeded); the
      delivery path is built and tested but unexercised by any live product.
- [ ] `woc_store_view.ts`'s `buildArmorySections`/`ArmorySection`/`WocStoreItemInput` are no
      longer called by any production code now that the Store tab uses
      `woc_general_store_view.ts` (only `armorySkinArt`/`ArmorySkinRow` are still used); kept for
      now since they are still individually correct and tested, full removal deferred.
