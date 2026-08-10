#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
python3 - <<'PY'
s = open('src/lib/seasonCache.js', encoding='utf-8').read()
s = s.replace("import { supabase } from './supabase'",
              "let supabase\nexport function __setClient(c) { supabase = c }")
open('/tmp/cache-src.js', 'w', encoding='utf-8').write(s)
PY
npx --yes esbuild@0.21.5 /tmp/cache-src.js --bundle --format=esm --outfile=/tmp/cache.mjs >/dev/null 2>&1
node scripts/check-cache.mjs
