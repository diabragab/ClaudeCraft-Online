#!/usr/bin/env bash
# Merge the refreshed main into shop-claudium. Run scripts/update-from-upstream.sh
# first. On a conflict, this calls out the known Tier-2 watch list (files that
# exist both upstream and in the Shop layer, where a real conflict is expected
# from time to time) so it is never a surprise; any OTHER conflicted file is new
# and worth a closer look before resolving.
set -euo pipefail

WATCH_LIST=(
  "src/ui/daily_rewards_window.ts"
  "src/ui/hud.ts"
  "src/main.ts"
  "src/ui/armory_inspect.ts"
  "src/render/armory_preview.ts"
  "src/sim/content/weapon_skin_rules.ts"
)

git checkout shop-claudium

if git merge --no-edit main; then
  echo "clean merge"
else
  echo
  echo "Conflicts found. Known Shop/upstream overlap files (expected occasionally):"
  for f in "${WATCH_LIST[@]}"; do
    if git diff --name-only --diff-filter=U | grep -qx "$f"; then
      echo "  - $f"
    fi
  done
  echo
  echo "Full conflict list:"
  git diff --name-only --diff-filter=U
  echo
  echo "Any file above NOT in the watch list is new territory - read it before resolving."
  echo "Once resolved: git add <files>, git commit, then ./scripts/verify-merge.sh"
  exit 1
fi

echo "regenerating i18n (only the hand-authored catalog/locale sources were merged;"
echo "the generated tables must be rebuilt, never hand-merged)..."
npm run i18n:gen

echo
echo "next: ./scripts/verify-merge.sh"
