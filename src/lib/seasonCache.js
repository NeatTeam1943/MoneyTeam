import { supabase } from './supabase'

/**
 * A short-lived cache for the reference data every page reloads.
 *
 * `budgets` is fetched by six pages, `ledger_lines_full` and `shopping_items`
 * by five. Walking Dashboard → Transactions → Budgets → Shopping fetched each
 * of them three or four times over, and the pages were already parallel
 * internally — so the waiting was between pages, not inside them.
 *
 * WHY THIS IS SAFE, when I argued against storing balances:
 *
 * A stored balance is a second copy of a derived number with no owner — the
 * ledger changes and the copy silently disagrees, forever. This is a copy of a
 * QUERY RESULT with a 30-second life and an explicit kill switch: any write
 * clears the affected table immediately, so a stale read is only possible for
 * data nobody has changed. It cannot drift, because it does not persist.
 *
 * The rules that keep it honest:
 *   - every mutation calls invalidate() for the table it touched
 *   - the cache is keyed by season, so switching seasons never serves the wrong
 *     one
 *   - TTL is a backstop for changes made in ANOTHER browser, not the mechanism
 *   - nothing here is written to disk: a reload starts clean
 */
const TTL_MS = 30_000
const store = new Map()   // key -> { at, rows }

const keyOf = (table, seasonId, columns) => `${table}|${seasonId ?? '-'}|${columns ?? '*'}`

/** Drop everything for one table, or the whole cache when called bare. */
export function invalidate(table) {
  if (!table) { store.clear(); return }
  for (const k of [...store.keys()]) {
    if (k.startsWith(`${table}|`)) store.delete(k)
  }
}

/**
 * Fetch a season-scoped table, reusing a recent result.
 *
 * @param seasonColumn  null for tables that are not season-scoped
 *                      (account_balances spans every season by design)
 */
export async function fetchCached(table, {
  seasonId, columns = '*', seasonColumn = 'season_id', force = false,
} = {}) {
  const key = keyOf(table, seasonColumn ? seasonId : null, columns)
  const hit = store.get(key)
  if (!force && hit && Date.now() - hit.at < TTL_MS) {
    return { data: hit.rows, error: null, cached: true }
  }

  let q = supabase.from(table).select(columns)
  if (seasonColumn && seasonId) q = q.eq(seasonColumn, seasonId)
  const { data, error } = await q

  // Never cache a failure: an RLS refusal or a dropped request would otherwise
  // be repeated for 30 seconds as if it were an empty table.
  if (!error) store.set(key, { at: Date.now(), rows: data || [] })
  return { data: data || [], error, cached: false }
}

/**
 * A write helper that clears the cache for the table it touched.
 *
 * Invalidation lives HERE rather than at each call site on purpose: there are a
 * dozen places that insert, update or delete a cached table, and the one that
 * gets forgotten is the one that serves stale data. A single wrapper cannot be
 * forgotten — if a write goes through `mutate`, the cache is correct by
 * construction.
 *
 *   await mutate('budgets', (q) => q.insert(payload))
 */
export async function mutate(table, build) {
  const res = await build(supabase.from(table))
  // Cleared even on failure: a partial write, or a policy that allowed some
  // rows and refused others, still leaves the cached copy untrustworthy.
  invalidate(table)
  return res
}

/** For tests and for the "something changed elsewhere" path. */
export const _size = () => store.size
