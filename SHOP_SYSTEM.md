# Shop System

This document is the architectural and scope reference for the in-house Shop System: the
admin-managed catalog, inventory, and orders backend (Phases 1-3), the public customer
storefront built on top of it (Phase 4), and the in-game Shop behind the Treasure Chest icon
that now runs on the same catalog (Phase 5). It exists so a later phase (a payment gateway)
starts from an explicit record of what was decided and why, rather than re-deriving it from
the diff.

For schema details see `DATABASE.md`; for the endpoint reference see `API.md`; for what shipped
in which phase and what remains see `TASKS.md`.

## Relationship to the existing Claudium/weapon-skin store

Before this system existed, World of ClaudeCraft already had a live store: Claudium currency
packs and weapon cosmetics, described in `docs/claudium-store.md`. That store's pricing and
purchase ledger are owned by an **external economy service**; the game server only mirrors
entitlements it is told about.

**Scope decision (Phase 1):** the Shop System built here is a **new, in-house source of
authority**, not a client of the external economy service. `shop_products`/`shop_categories`/
`shop_inventory`/`shop_orders` are entirely separate tables from anything the Claudium store
touches, own their own pricing, and are managed entirely through this repo's admin dashboard.
The two systems are unrelated today; a future phase could migrate the Claudium store onto this
backend, or leave them separate permanently, but that decision has not been made and nothing in
Phases 1-3 assumes it.

## Currency model

A `shop_products` row can carry a price in any combination of three currencies
(`price_gold_copper`, `price_claudium`, `price_usd_cents`; at least one is required), plus three
boolean flags gating which crypto rail (SOL/USDC/WOC) may be used to pay a USD-priced product.
This is data-model support for "gold and Claudium and real money via Stripe and crypto" (the
Phase 1 scope decision); **no payment integration exists yet**. An order (Phase 3) is created in
exactly ONE of the three currencies (`shop_orders.currency`), fixed for the whole order, using
whichever of the product's three price fields matches. There is no currency conversion anywhere
in this system: an order in `usd` against a product with no `price_usd_cents` set is rejected
(`price_not_set`), it does not fall back to a converted gold price.

## What each phase built

- **Phase 1 (catalog + inventory backend).** `shop_categories` (a self-referential tree),
  `shop_products` (the pricing/rails/status data above), `shop_inventory` (per-product stock
  tracking, `quantity_on_hand`/`quantity_reserved`/`low_stock_threshold`/`unlimited`, plus an
  append-only `shop_inventory_adjustments` audit trail). Full CRUD REST API, no admin UI, no
  checkout.
- **Phase 2 (admin UI over Phase 1).** Three Svelte pages (`src/admin/pages/ShopCategories.svelte`,
  `ShopProducts.svelte`, `ShopInventory.svelte`) consuming the Phase 1 endpoints. No new
  server-side logic.
- **Phase 3 (orders).** `shop_orders`/`shop_order_items`/`shop_order_status_history`, the order
  state machine, transactional stock reservation/deduction, the orders REST API, and the Orders +
  Order Details admin pages. See the scope decision below.
- **Phase 4 (public storefront).** A new player-facing `/store` SPA (browse, cart, checkout,
  order history) plus a new public/player REST surface (`/api/shop/*`) it talks to. No new
  catalog or order business logic: every read/write is a thin wrapper over the exact same
  Phase 1/3 services. See "Phase 4 scope decisions" below.
- **Phase 5 (in-game Shop).** The Treasure Chest icon's Store tab (previously a bespoke Season 1
  Armory grid paid via the external economy service's spend endpoint) now renders the general
  Shop System catalog, Claudium-only, with immediate server-side delivery. Weapon skins were
  migrated INTO `shop_products` (a boot-time seed) rather than kept as a second purchase path.
  See "Phase 5 scope decisions" below.

## Phase 3 scope decision: back-office orders, not a storefront

The Phase 3 brief asked for "Orders & Purchase System" but explicitly excluded payment gateways
and a customer storefront ("do not implement payment gateways or customer storefront yet"). With
no player-facing checkout to originate an order, **order creation in this phase is
admin-only**: `POST /admin/api/shop/orders` is a back-office order-entry tool an operator uses
directly (phone orders, manual grants, compensation, testing), not something a player ever calls.
This mirrors the admin-only posture Phase 1/2 already established for the whole catalog.

Consequences of this decision, so a later phase can find and revisit them deliberately:

- **Permissions are reused, not added.** Every orders endpoint is gated by the existing
  `shop.read` (reads) / `shop.manage` (writes) permissions (`server/admin_permissions.ts`,
  `server/admin_routes.ts`); there is no separate "place an order" permission a future
  player-facing surface would need, since no such surface exists yet.
- **`shop_orders.account_id` names WHO the order is for, not who is buying.** An operator
  supplies the `accountId` directly in the create request; there is no session/auth concept of
  "the calling player" on this surface, because the caller is always an operator.
- **No idempotency key, no payment webhook handler, no receipt/email.** These all become
  necessary the moment a real payment gateway is wired in; none of that exists today, and the
  order's `note` field is the only place a human explanation lives.
- **The state machine already anticipates a gateway.** `pending -> paid` is exactly the
  transition a Stripe/crypto webhook would eventually drive automatically (see the state machine
  table in `DATABASE.md`); today it is a manual "Mark paid" button on the Order Details page.
  Wiring a real gateway means adding a webhook-driven caller of the SAME `ShopOrdersService`
  transition methods (`server/shop_orders.ts`), not a new state machine.

**Do not read the above as fully settled**: it is the explicit interpretation this phase acted
on, called out clearly (as Phase 1's economy-boundary decision and Phase 2's UI-only decision
were) so it can be confirmed or redirected before a customer-facing phase is built on top of it.

## Business rules enforced (Phase 3)

- **Inventory decreases only after a successful purchase.** Order creation only RESERVES stock
  (`shop_inventory.quantity_reserved`); `quantity_on_hand` itself is only decremented at the
  `pending -> paid` transition. See the full state machine and stock-effect table in
  `DATABASE.md`.
- **Purchasing an unavailable product is prevented.** A product must be `status: 'active'` and
  carry a non-null price in the order's currency; a product with no `shop_inventory` row at all is
  never orderable, even if it would otherwise be `unlimited`.
- **Negative inventory is prevented.** A non-`unlimited` product's available stock
  (`quantity_on_hand - quantity_reserved`) must cover the requested quantity at creation, enforced
  under `SELECT ... FOR UPDATE` inside the same transaction as the reservation, so two concurrent
  orders for the last unit of stock cannot both succeed.
- **Every operation is transactional.** A create (validate every line item + insert order + insert
  items + reserve stock + write the initial history row) and a status transition (apply the stock
  effect + update status + write a history row) each run as one Postgres transaction in
  `server/shop_orders_db.ts`; nothing is partially applied.

## Phase 4 scope decisions: a new SPA, a new public API surface, a client-side cart

Phase 4's brief asked for a full public storefront (browse/cart/checkout/order history) built by
"reusing the existing architecture, services, and APIs" and explicitly forbade payment gateways.
Four decisions followed from that, each stated here so a later phase can find and revisit them
deliberately, the same way Phase 1's economy-boundary call and Phase 3's admin-only-orders call
are recorded above.

1. **The storefront is a new standalone SPA (`/store`, `store.html` -> `src/store/`), not an
   in-game HUD window.** The brief's own vocabulary ("Home page," pagination, search, filters) is
   web-page vocabulary, and this repo already has exactly this shape four times over (`guide.html`
   at `/wiki`, `editor.html`, `admin.html`, `play.html`). `src/store/` is plain TypeScript/DOM,
   like the game client and the Guide: Svelte remains the one sanctioned exception, scoped to
   `src/admin/` only (root `CLAUDE.md`), so the storefront could not reuse the admin dashboard's
   Svelte components even though their SHAPE (list + filter + paginate + detail) is very close;
   it reuses the same underlying design tokens (colors, typefaces) instead, for visual
   consistency without a second UI framework.
2. **A new public/player REST surface (`/api/shop/*`), separate from the admin surface
   (`/admin/api/shop/*`), because the admin surface is intentionally staff-only.** The existing
   Phase 3 admin orders API (`requireAdmin` + `shop.manage`) cannot safely be exposed to players
   directly. `server/shop_storefront_catalog_routes.ts` (anonymous, active-only catalog reads)
   and `server/shop_storefront_orders_routes.ts` (`requireAccount`-gated "my orders", accountId
   always the caller's own) are the separately-permissioned path `SHOP_SYSTEM.md`'s own "Extending
   this system" section already called for in Phase 3. Every handler on both is a thin wrapper:
   zero catalog or order business logic is duplicated, only reused
   (`ShopCategoriesService`/`ShopProductsService`/`ShopInventoryService`/`ShopOrdersService`).
   Player authentication reuses the SAME account bearer-token model (and the SAME `woc_session`
   localStorage key) the game client and the homepage account portal already use; there is no
   separate storefront login or registration form.
3. **The cart is client-side (localStorage, `src/store/cart.ts` + `cart_storage.ts`), not a new
   server-side cart table.** Nothing in Phase 4's Backend requirements asked for a cart API, and
   the AUTHORITATIVE inventory/price check the cart needs already exists: `ShopOrdersService.
   createOrder`, unconditionally re-run at checkout. A cart line item snapshots its product's
   slug/name/price at add-to-cart time (mirroring `shop_order_items`' own snapshot-at-write-time
   design from Phase 3), so the cart and checkout-review pages never need a second product
   lookup; the snapshot is cosmetic only and never gates or prices the actual purchase. A cart is
   scoped to exactly one currency (matching `shop_orders.currency`'s own one-currency-per-order
   constraint): adding a product priced in a different currency than what is already in the cart
   is rejected, not silently mixed.
4. **"Purchase confirmation" confirms an order was PLACED, not that a payment completed.** There
   is still no payment gateway (explicitly out of scope), so checkout creates a `pending` order
   exactly like the admin-created ones from Phase 3, and the confirmation page says so in plain
   language (`store.checkout.paymentNote`, `store.confirmation.body`): the order awaits manual
   confirmation, the same `pending -> paid` step SHOP_SYSTEM.md's Phase 3 section already
   described as "a manual 'Mark paid' button... until a gateway exists."

**What Phase 4 deliberately does NOT add**, so a later phase does not assume it exists: a player
cannot cancel or self-serve refund their own order (no such endpoint; only the admin surface can
transition a status), there is no email/receipt on order placement, and there is no idempotency
key on `POST /api/shop/orders` (a double-submit currently creates two orders; harmless today
since nothing charges a card yet, but worth revisiting once a payment gateway lands).

## Phase 5 scope decisions: one Store tab, migrated Armory, Claudium-only, immediate delivery

Phase 5's brief was explicit: keep the existing Treasure Chest icon, WOC Store window, and
Store/Daily Rewards tabs exactly as they are; replace only the Store tab's content with the
general Shop System, Claudium-only, with real purchases and real delivery. Five decisions
followed, recorded here the same way every prior phase's calls are.

1. **Weapon skins were migrated INTO `shop_products`, not retired.** The old Armory sold exactly
   the `WEAPON_SKIN_LIST` catalog, priced and spent through the external economy service's
   `kind: 'skin'` endpoint. A boot-time idempotent seed (`server/shop_armory_seed.ts`) now
   mirrors that same list into ordinary `shop_products` rows (`grantKind: 'weapon_skin'`,
   `grantItemId` = the skin id, priced from the Season 1 tier ladder already documented in
   `docs/claudium-store.md`), under a new "Armory" category. Once seeded, price is an ordinary
   admin-editable Products-page field, not re-synced from that ladder again. This is what let
   the purchase FLOW collapse to one system while the delivery MECHANISM (the account-cosmetics
   grant) stayed exactly what it already was.
2. **The economy service is still the sole Claudium balance authority; `shop_products` only
   owns price and what a purchase delivers.** The in-game Shop's checkout still calls the same
   `claudiumSpend` (`server/claudium_proxy.ts`) the old Armory purchase called, with the same
   per-item `kind` (`'skin'` for a migrated weapon skin, `'item'` for anything else); nothing
   here reimplements or shadows the service's ledger.
3. **The in-game Shop shows Claudium-priced products only, and shows every one of them
   (`priceGoldCopper`/`priceUsdCents`-only products don't appear here at all).** This is a
   client-side filter in `woc_general_store_view.ts`'s consumer, not a new server query
   parameter: the existing `/api/shop/products` list already returns every price field, and the
   web storefront (Phase 4) still shows all three currencies. A product with no Claudium price
   simply never renders in this ONE surface.
4. **Delivery is immediate and reuses two existing grant paths, never a new one.** A
   `grantKind: 'weapon_skin'` purchase calls `grantWeaponSkinForShop` (`server/claudium.ts`),
   already live-game-wired via `configureClaudiumRuntime`. A `grantKind: 'item'` purchase mails
   `grantQuantity` of `grantItemId` straight into the buyer's live mailbox
   (`PostOffice.mailShopItem`, mirroring the existing `mailHeroicMarks` reward-hook pattern),
   via a new but equally thin `configureShopCheckoutRuntime` hook. Both only work because a
   Claudium purchase can only originate from an already-online character; there is no offline
   delivery case to solve here, unlike the web storefront's mail-eligible future.
5. **The old Armory-only purchase UX (single-item confirm-then-buy, no cart) was kept, not
   replaced by the web storefront's cart+checkout model.** The brief's own framing ("Keep the
   existing... window layout") and the fact that the pre-existing Armory tab never had a cart
   both point the same way: `requestPurchase`/`purchaseProduct` buy one product at a time,
   confirmed via the same `confirmDialog` hook the Armory always used. The general Shop
   System's cart/checkout machinery (Phase 4) is untouched and serves the web storefront alone.

**What Phase 5 deliberately does NOT add**, so a later phase does not assume it exists: a
`grantKind: 'item'` product has no real catalog content yet (the seed only populates weapon
skins); a player cannot buy more than one distinct product per checkout call (quantity of ONE
product, not a multi-item cart); and `woc_store_view.ts`'s now-unused `buildArmorySections`/
`ArmorySection`/`WocStoreItemInput` were left in place rather than deleted (see TASKS.md's
deferred list).

## Extending this system

Follow the seams already in place rather than inventing new ones:

- A new catalog field or business rule: extend the matching `server/shop_<domain>.ts` /
  `_db.ts` / `_routes.ts` triplet (never inline SQL in a routes file; never a new admin auth
  gate, reuse `requireAdmin` from `server/admin.ts`). If the field should also be visible
  publicly, thread it through `server/shop_storefront_catalog_routes.ts`'s response too (see
  `featured`, added exactly this way in Phase 4).
- A new order status or transition: extend the `TRANSITIONS` table in
  `server/shop_orders.ts`'s `transitionEffect`, plus the stock-effect switch in
  `server/shop_orders_db.ts`'s `applyStockEffect`; update the state-machine table in
  `DATABASE.md` in the same change.
- A payment gateway integration: a new module that calls into `ShopOrdersService`'s existing
  `updateStatus`/`refundOrder` methods from a webhook handler, rather than a parallel status-write
  path. The storefront's checkout flow (`src/store/pages/checkout.ts`) does not need to change:
  it already creates a `pending` order and shows the player their own order status afterward.
- A new storefront page: a `src/store/pages/<name>.ts` module implementing the `StorePage`
  interface (`src/store/page.ts`), registered in `src/store/pages/index.ts`'s `PAGES` map behind
  a new `StoreRouteId` (`src/store/routes.ts`), never markup appended to `app.ts`. Player-facing
  strings are `store.*` `t()` keys in `src/ui/i18n.catalog/store.ts` (English-only add; a new
  wordy value needs its five non-Latin locale fills in the same change, the M16 rule every other
  game-client catalog domain follows).
- A new deliverable product for the in-game Shop: set `grantKind`/`grantItemId`/`grantQuantity`
  on the Products admin page (no code change for `weapon_skin`, since the grant path already
  exists; `grantKind: 'item'` needs `grantItemId` to be a real `src/sim/content` `ITEMS` key,
  since `PostOffice.mailShopItem` mails it verbatim). Never add a third grant kind without also
  extending `server/shop_claudium_checkout.ts`'s `deliver()` switch in the same change.
- A player-initiated order action (self-serve cancel, a receipt email): a new
  `server/shop_storefront_orders_routes.ts` endpoint reusing `ShopOrdersService`'s existing
  `cancelOrder`/`updateStatus`, scoped to the caller's own order the same way `GET .../orders/:id`
  already is (`requireOwned`, `ownerScope: 'account'`), never a new parallel order-mutation path.
