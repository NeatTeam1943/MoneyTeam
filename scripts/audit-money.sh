#!/usr/bin/env bash
# Bundles the domain modules, then runs the cross-cutting money audit.
set -euo pipefail
cd "$(dirname "$0")/.."
for m in budgets budgetOwnership budgetResolver simulation ledger shopping goals simSnapshot yearOutlook; do
  npx --yes esbuild@0.21.5 "src/domain/$m.js" --bundle --format=esm \
    --outfile="/tmp/A_$m.mjs" >/dev/null 2>&1
done
npx --yes esbuild@0.21.5 src/lib/teamScope.js --bundle --format=esm \
  --outfile=/tmp/A_ts.mjs >/dev/null 2>&1
# aggregate lives in export.js, which pulls in xlsx — bundle just that function
# rather than the whole module, so the audit stays free of browser globals.
node -e "
const fs=require('fs');
const src=fs.readFileSync('src/lib/export.js','utf8');
const a=src.indexOf('export function aggregate');
const b=src.indexOf('\n}', a)+2;
fs.writeFileSync('/tmp/A_aggregate.mjs', src.slice(a,b));
"
node scripts/audit-money.mjs
