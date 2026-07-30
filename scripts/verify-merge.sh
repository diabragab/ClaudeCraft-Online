#!/usr/bin/env bash
# Post-merge verification for shop-claudium: type-check, the Shop-domain test
# suites, and a full build. Run after scripts/merge-shop.sh (or after any
# manual change touching the Shop). Ends with a manual smoke-test checklist
# for the four systems that can't be proven by an automated suite alone.
set -euo pipefail

echo "=== tsc --noEmit ==="
npx tsc --noEmit

echo
echo "=== Shop-domain test suites ==="
npx vitest run \
  tests/claudium_ledger.test.ts tests/claudium_packages.test.ts tests/claudium_purchases.test.ts \
  tests/claudium_view.test.ts tests/claudium_window.test.ts tests/claudium_launcher_balance.test.ts \
  tests/server/claudium.test.ts tests/server/claudium_ledger_routes.test.ts \
  tests/server/claudium_packages_routes.test.ts tests/server/claudium_purchases_routes.test.ts \
  tests/server/stripe_checkout_creator.test.ts tests/server/stripe_client.test.ts \
  tests/server/stripe_config.test.ts tests/server/stripe_webhook_routes.test.ts \
  tests/shop_ledger_checkout.test.ts tests/shop_armory_seed.test.ts tests/shop_categories.test.ts \
  tests/shop_products.test.ts tests/shop_inventory.test.ts tests/shop_orders.test.ts \
  tests/shop_storefront.test.ts \
  tests/woc_general_store_view.test.ts tests/woc_store_window_contract.test.ts \
  tests/armory_store_view.test.ts \
  tests/daily_rewards_store_behavior.test.ts \
  tests/admin/claudium_packages.test.ts tests/admin/claudium_purchases.test.ts \
  tests/admin/shop_categories.test.ts tests/admin/shop_products.test.ts \
  tests/admin/shop_inventory.test.ts tests/admin/shop_orders.test.ts tests/admin/shop_order_detail.test.ts \
  tests/store/ tests/architecture.test.ts

echo
echo "=== full build (all 5 entries) ==="
npm run build

echo
echo "Automated checks passed. Manual smoke test before shipping:"
echo "  [ ] Claudium ledger: buy a weapon skin in-game, balance debits, purchase history logs it"
echo "  [ ] Stripe: POST /api/shop/packages/:id/checkout returns a real session URL (test key)"
echo "  [ ] Treasure Chest: Store tab AND Packages tab both render, package inspect panel opens"
echo "  [ ] Admin Panel: /admin -> Shop Products/Categories/Orders/Claudium Packages/Purchases all load"
echo
echo "For a full pre-push gate (typecheck + guards + biome + tests + tsc + build), run: npm run gate"
