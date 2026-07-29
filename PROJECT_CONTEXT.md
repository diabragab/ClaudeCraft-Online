# Shop System: project context

A short-lived "what is this and why" pointer document for the Shop System build-out, kept
alongside `SHOP_SYSTEM.md` (architecture/scope), `DATABASE.md` (schema reference), `API.md`
(endpoint reference), and `TASKS.md` (phase-by-phase status). Read this one first if you are
new to the initiative; it explains how the other four fit together and what state the project
is in as of Phase 5.

## What this is

A new, in-house shop for World of ClaudeCraft: a product catalog (categories + products), stock
tracking (inventory), an orders system, a public customer-facing storefront (`/store`), and now
the in-game Shop reached from the Treasure Chest icon (Phase 5) — each backed by a full REST
API, an admin dashboard UI (Svelte, staff-only), and player-facing surfaces (a `/store` SPA
since Phase 4, the existing in-game HUD window since Phase 5). It is unrelated to the game's
existing Claudium currency-pack store (`docs/claudium-store.md`), whose Claudium BALANCE ledger
remains owned by an external economy service — but as of Phase 5, weapon skins (previously sold
only through that service's own catalog) are ALSO ordinary `shop_products` rows, purchased
through this system and paid for via the same external Claudium balance. See `SHOP_SYSTEM.md`'s
"Relationship to the existing Claudium/weapon-skin store" and "Phase 5 scope decisions" sections
for the exact boundary.

## Why it exists as a separate initiative

The project was commissioned in five phases, each scoped and delivered independently so a
foundational layer (data model + validation, then orders) was solid before either customer-facing
surface was built on top of it:

1. **Phase 1: Shop Backend Foundation.** Schema, validation, and full CRUD REST APIs for
   Categories/Products/Inventory. No admin UI, no checkout.
2. **Phase 2: Admin Panel UI.** Svelte pages consuming the Phase 1 endpoints. No new backend
   logic.
3. **Phase 3: Orders & Purchase System.** Order creation, status management (with stock
   reservation/deduction), and the corresponding admin UI. Explicitly NOT a payment gateway or
   customer storefront yet.
4. **Phase 4: Public Storefront.** A player-facing `/store` SPA (browse, cart, checkout, order
   history) built entirely on the Phase 1-3 services via a new public/player REST surface. Still
   explicitly NOT a payment gateway.
5. **Phase 5: In-Game Shop.** The Treasure Chest icon's existing Store tab, previously a bespoke
   Season 1 Armory grid paid through the external economy service directly, now renders the
   general catalog, Claudium-only, with real purchases and immediate delivery. Weapon skins
   migrated into `shop_products`; the window, tabs, and icon are unchanged.

Scope decisions were made explicit, in writing, before each phase's implementation, rather than
assumed silently:

- **Phase 1: this is a new in-house authority**, not a client of the external economy service
  (the alternative considered and rejected).
- **Phase 3: order creation is admin-only** (a back-office tool), since there is still no
  payment gateway or storefront to originate an order from.
- **Phase 4: the storefront is a new standalone SPA with its own public REST surface, a
  client-side cart, and a "placed, not paid" confirmation.**
- **Phase 5: weapon skins migrate INTO the catalog rather than staying a second purchase path;
  the in-game Shop shows Claudium-priced products only; delivery reuses two existing grant
  paths (account-cosmetics grant, mail) rather than inventing a third; the single-item
  confirm-then-buy UX the old Armory had is kept, not replaced by the storefront's cart model.**

See `SHOP_SYSTEM.md`'s "Phase 3 scope decision", "Phase 4 scope decisions", and "Phase 5 scope
decisions" sections for the full reasoning and consequences of each.

## Current status (end of Phase 5)

All five phases are complete and tested:

- Database: 7 tables (`shop_categories`, `shop_products` (+ Phase 4's `featured` column and
  Phase 5's `grantKind`/`grantItemId`/`grantQuantity` columns), `shop_inventory`,
  `shop_inventory_adjustments`, `shop_orders`, `shop_order_items`, `shop_order_status_history`),
  applied as idempotent boot DDL (no migration tool in this repo; see `DATABASE.md`'s "Schema
  management" section). No new tables in Phase 4 or 5. A boot-time idempotent seed
  (`server/shop_armory_seed.ts`) populates the Armory category + weapon-skin products.
- API: full CRUD over `/admin/api/shop/{categories,products,inventory}` plus the admin orders
  surface over `/admin/api/shop/orders` (staff-only, `list/create/get/status/cancel/refund`), the
  public/player surface over `/api/shop/*` (anonymous catalog browsing, a player's own orders:
  `create/list/get`), and the new `POST /api/shop/claudium/purchase` (Phase 5: buy one product
  with Claudium, delivered immediately). See `API.md`.
- Admin UI: six pages under the dashboard's "Shop" nav section (Categories, Products — now with
  grant-kind fields, Inventory, Orders) plus an Order Details page reached from the Orders list.
- Storefront UI: a standalone SPA at `/store` (`store.html` -> `src/store/`) - home (featured +
  new arrivals), categories, product listing/search/detail, cart, checkout, order confirmation,
  and order history/detail, sharing the game client's account session. Unchanged by Phase 5.
- In-game Shop UI: the existing Treasure Chest icon / `#daily-rewards-window` Store tab
  (`src/ui/daily_rewards_window.ts`), now backed by `src/net/shop_client.ts` +
  `src/ui/woc_general_store_view.ts` instead of the old Armory-only view; search, category
  filter, and buy-with-Claudium against the live catalog balance.
- Tests: service-level unit tests (in-memory fakes) and route-level tests (real middleware onion)
  for every backend domain, Svelte component tests for every admin page, pure-core + jsdom
  component + integration tests for every storefront page and the cart engine, and (Phase 5)
  checkout-orchestration + route + pure-view-core + seed-idempotency tests for the in-game Shop.

## What is explicitly NOT built yet

- No payment gateway integration (Stripe, crypto rail settlement) for the WEB storefront — the
  three price fields and rail flags on `shop_products` are data-model support for this, not a
  working integration; a storefront order is still created `pending` and confirmed manually by
  an operator. (The in-game Shop's Claudium checkout already settles synchronously; it needs no
  gateway.)
- No player self-service order cancellation or refund, no order-confirmation email/receipt, no
  idempotency key on the web storefront's order creation (the in-game Claudium checkout has its
  own deterministic per-order idempotency key, see `SHOP_SYSTEM.md`'s Phase 5 section).
- `grantKind: 'item'` (mail-delivered generic items) has a built and tested delivery path but no
  real catalog content yet; only weapon skins are seeded.
- `woc_store_view.ts`'s `buildArmorySections`/`ArmorySection`/`WocStoreItemInput` are no longer
  called by production code (superseded by `woc_general_store_view.ts`) but were left in place
  rather than deleted.

## Where to look next

| Question | Document |
|---|---|
| "What tables exist and how do they relate?" | `DATABASE.md` |
| "What does this endpoint accept/return/reject?" | `API.md` |
| "Why does X work this way, and what should I NOT casually change?" | `SHOP_SYSTEM.md` |
| "What shipped in which phase, what's left?" | `TASKS.md` |
| "How do I add a new field/rule/status/page without breaking a convention?" | `SHOP_SYSTEM.md`'s "Extending this system" section |
