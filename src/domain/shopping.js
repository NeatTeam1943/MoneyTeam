import { BUYABLE_STATUSES } from './constants'
import { lineTotalOf } from './money'

// Shopping-list filtering, searching and sorting, extracted from Shopping.jsx.

/** Fields a free-text search looks through — everything you might plausibly
 *  remember about an item. */
// Everything a person might type. The status and program were missing, so
// searching "אושר" or "FTC" found nothing even though both are on screen.
const SEARCHABLE = ['name', 'sku', 'vendor', 'categoryName', 'priorityName',
  'notes', 'description', 'statusLabel', 'team_scope']

export function matchesSearch(row, needle) {
  if (!needle) return true
  const q = needle.trim().toLowerCase()
  if (!q) return true
  if (SEARCHABLE.some((f) => String(row[f] || '').toLowerCase().includes(q))) return true
  // Links are searchable too — pasting part of a supplier URL is a natural way
  // to find the row you already have open in another tab.
  const links = row.urls?.length ? row.urls : (row.url ? [row.url] : [])
  return links.some((u) => String(u || '').toLowerCase().includes(q))
}

export const isBuyable = (row) => BUYABLE_STATUSES.includes(row.status)

/** Sort value for a column. Kept beside the sorter so adding a column means
 *  touching one place. */
export function sortValue(row, col, { rankOf, statusLabel }) {
  switch (col) {
    case 'priority': return rankOf[row.priority_level_id] ?? 999
    case 'est_price': return Number(row.est_price) || 0
    case 'quantity': return Number(row.quantity) || 0
    case 'category': return row.categoryName || ''
    case 'name': return row.name || ''
    case 'vendor': return row.vendor || ''
    case 'status': return statusLabel(row.status) || ''
    default: return row[col] ?? ''
  }
}

/**
 * Sort by one column, then break ties with another.
 *
 * `sort.then` is the secondary column — sorting by category alone left the
 * rows inside each category in whatever order they arrived, which is the point
 * at which a long list stops being scannable.
 */
export function sortRows(rows, sort, helpers) {
  const mul = sort.dir === 'asc' ? 1 : -1
  const thenMul = sort.thenDir === 'desc' ? -1 : 1
  const cmp = (a, b, col, m) => {
    const av = sortValue(a, col, helpers)
    const bv = sortValue(b, col, helpers)
    if (av < bv) return -1 * m
    if (av > bv) return 1 * m
    return 0
  }
  return [...rows].sort((a, b) => {
    const primary = cmp(a, b, sort.col, mul)
    if (primary !== 0) return primary
    return sort.then ? cmp(a, b, sort.then, thenMul) : 0
  })
}

/**
 * @param {object} f  search, statuses (array — empty means no status filter),
 *                    priority
 *
 * `statuses` replaced a single `status`: picking one status at a time cannot
 * express "everything still in flight", which is the normal way to read this
 * list. An empty array means no filtering at all, so "select none" and "select
 * all" stay distinguishable.
 */
/**
 * @param f  search, statuses[], priority, categories[], scopes[], minPrice,
 *           maxPrice, hasPrice
 *
 * `categories` is a Set of ids INCLUDING descendants — picking "רובוט" is
 * expected to bring its children, and expanding the subtree in the caller
 * keeps this function free of tree knowledge.
 */
export function filterRows(rows, f = {}) {
  const { search, statuses, priority, categories, scopes, minPrice, maxPrice, hasPrice } = f
  const statusSet = statuses?.length ? new Set(statuses) : null
  const catSet = categories?.size ? categories : null
  const scopeSet = scopes?.length ? new Set(scopes) : null
  const min = minPrice === '' || minPrice == null ? null : Number(minPrice)
  const max = maxPrice === '' || maxPrice == null ? null : Number(maxPrice)

  return rows.filter((r) => {
    if (!matchesSearch(r, search)) return false
    if (statusSet && !statusSet.has(r.status)) return false
    if (priority && r.priority_level_id !== priority) return false
    if (catSet && !catSet.has(r.category_id)) return false
    if (scopeSet && !scopeSet.has(r.team_scope || 'both')) return false

    // A row with no price is neither above nor below a threshold. Excluding it
    // from a "cheaper than X" search would hide the very rows that still need
    // a price, so a range filter leaves priced rows only when a bound is set.
    const priced = r.est_price != null && r.est_price !== ''
    if (hasPrice === 'yes' && !priced) return false
    if (hasPrice === 'no' && priced) return false
    if ((min != null || max != null)) {
      if (!priced) return false
      const total = lineTotalOf(r)
      if (min != null && total < min) return false
      if (max != null && total > max) return false
    }
    return true
  })
}

/** Estimated value per category label. */
export function estimateByCategory(rows, labelOf) {
  const m = {}
  for (const r of rows) {
    const k = labelOf(r)
    m[k] = (m[k] || 0) + lineTotalOf(r)
  }
  return m
}
