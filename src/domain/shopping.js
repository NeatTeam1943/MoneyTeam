import { BUYABLE_STATUSES } from './constants'
import { lineTotalOf } from './money'

// Shopping-list filtering, searching and sorting, extracted from Shopping.jsx.

/** Fields a free-text search looks through — everything you might plausibly
 *  remember about an item. */
const SEARCHABLE = ['name', 'sku', 'vendor', 'categoryName', 'priorityName', 'notes', 'description']

export function matchesSearch(row, needle) {
  if (!needle) return true
  const q = needle.trim().toLowerCase()
  if (!q) return true
  return SEARCHABLE.some((f) => String(row[f] || '').toLowerCase().includes(q))
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

export function sortRows(rows, sort, helpers) {
  const mul = sort.dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const av = sortValue(a, sort.col, helpers)
    const bv = sortValue(b, sort.col, helpers)
    if (av < bv) return -1 * mul
    if (av > bv) return 1 * mul
    return 0
  })
}

export function filterRows(rows, { search, status, priority }, helpers) {
  return rows.filter((r) =>
    matchesSearch(r, search)
    && (!status || r.status === status)
    && (!priority || r.priority_level_id === priority))
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
