#!/usr/bin/env bash
# Pull levy-street/world-of-claudecraft into main. main carries no local
# commits of its own (it exists purely to mirror upstream), so this is always
# a plain fast-forward and can never conflict. It never touches shop-claudium;
# run scripts/merge-shop.sh next to bring the refreshed base into the Shop
# branch.
set -euo pipefail

git fetch upstream
git checkout main
git merge --ff-only upstream/main

echo
echo "main is now at $(git rev-parse --short main)"
echo "$(git rev-list --count shop-claudium..main) new upstream commit(s) not yet in shop-claudium"
echo
echo "next: ./scripts/merge-shop.sh"
