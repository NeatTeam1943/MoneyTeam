#!/usr/bin/env bash
# Every check, with exit codes respected.
#
# This exists because reading the tail of a command's output is not the same as
# checking whether it passed. A page shipped with three undefined variables
# after `npm run lint | tail -1` printed a blank line — the errors were above
# it. Run this instead of eyeballing anything.
set -uo pipefail
fail=0

# Rebuild the bundles the golden masters import. Without this the checks happily
# exercise whatever was last written to /tmp — a stale artefact from an earlier
# edit — and report a pass for code that no longer exists. That is worse than no
# check at all, because it is trusted.
for m in budgets ledger shopping simulation; do
  npx --yes esbuild@0.21.5 "src/domain/$m.js" --bundle --format=esm \
    --outfile="/tmp/$m.bundle.mjs" >/dev/null 2>&1 || { echo "  bundle failed: $m"; exit 1; }
done
step() {
  printf '  %-34s' "$1"; shift
  out=$("$@" 2>&1); code=$?
  if [ $code -eq 0 ]; then echo "ok"; else echo "FAILED"; echo "$out" | tail -20 | sed 's/^/      /'; fail=1; fi
}
step "build"                 npm run build
step "lint (no-undef etc.)"  npm run lint
step "i18n keys"             node scripts/check-i18n.mjs
step "no raw money reads"    node scripts/check-approval-filter.mjs
step "golden master budgets" node scripts/golden-master-budgets.mjs
step "golden master ledger"  node scripts/golden-master-ledger.mjs
step "golden master shop+sim" node scripts/golden-master-shopping-sim.mjs
step "money audit (shared/split)" bash scripts/audit-money.sh
step "cache invalidation" bash scripts/check-cache.sh
step "copy matches behaviour" node scripts/check-stale-copy.mjs
echo
[ $fail -eq 0 ] && echo "  ALL CHECKS PASSED" || echo "  SOMETHING FAILED — do not ship"
exit $fail
