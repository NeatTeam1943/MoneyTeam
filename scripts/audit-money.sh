#!/usr/bin/env bash
# Bundles the domain modules, then runs the cross-cutting money audit.
set -euo pipefail
cd "$(dirname "$0")/.."
for m in budgets budgetOwnership budgetResolver simulation ledger shopping goals; do
  npx --yes esbuild@0.21.5 "src/domain/$m.js" --bundle --format=esm \
    --outfile="/tmp/A_$m.mjs" >/dev/null 2>&1
done
npx --yes esbuild@0.21.5 src/lib/teamScope.js --bundle --format=esm \
  --outfile=/tmp/A_ts.mjs >/dev/null 2>&1
node scripts/audit-money.mjs
