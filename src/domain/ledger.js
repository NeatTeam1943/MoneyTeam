import { TX } from './constants'
import { toNumber } from './money'

// Aggregations over transactions and expense lines.
//
// Extracted verbatim from Reports.jsx and Dashboard.jsx, which held two copies
// of most of this. Pure functions: no React, no Supabase, no translation — the
// caller supplies label lookups, so the same arithmetic serves both pages and
// can be exercised directly against production data.

/** Income / expense / in-kind, and net.
 *  `net` is null when only part of the programs are shown: income is shared
 *  and unsplit, so income arrives in full while expenses are narrowed, and
 *  subtracting one from the other is confidently wrong in a flattering
 *  direction. Callers render `—` for null rather than a number. */
export function totalsOf(rows, allProgramsShown) {
  let income = 0; let expense = 0; let inkind = 0
  for (const r of rows) {
    if (r.type === TX.INCOME) income += toNumber(r.amount)
    else if (r.type === TX.EXPENSE) expense += toNumber(r.amount)
    else if (r.type === TX.IN_KIND) inkind += toNumber(r.amount)
  }
  return { income, expense, inkind, net: allProgramsShown ? income - expense : null }
}

/** Income and expense per calendar month, oldest first. */
export function byMonthOf(rows, monthKey) {
  const m = {}
  for (const r of rows) {
    if (r.type !== TX.INCOME && r.type !== TX.EXPENSE) continue
    const k = monthKey(r.date)
    m[k] = m[k] || { month: k, income: 0, expense: 0 }
    m[k][r.type] += toNumber(r.amount)
  }
  return Object.values(m).sort((a, b) => a.month.localeCompare(b.month))
}

/** Running balance over the months produced by byMonthOf. */
export function cumulativeOf(byMonth) {
  let run = 0
  return byMonth.map((m) => {
    run += m.income - m.expense
    return { month: m.month, net: m.income - m.expense, cumulative: run }
  })
}

const descendingByValue = (a, b) => b.value - a.value

/** Generic { name, value } roll-up, sorted high to low. */
export function groupSum(rows, keyOf, amountOf = (r) => r.amount) {
  const m = {}
  for (const r of rows) {
    const k = keyOf(r)
    if (k == null) continue
    m[k] = (m[k] || 0) + toNumber(amountOf(r))
  }
  return Object.entries(m).map(([name, value]) => ({ name, value })).sort(descendingByValue)
}

/** Expense lines grouped by the category of the budget they were charged to. */
export const byCategoryOf = (lines, categoryLabel) => groupSum(lines, (l) => categoryLabel(l))

/** Income grouped by source. */
export const bySourceOf = (rows, sourceLabel) =>
  groupSum(rows.filter((r) => r.type === TX.INCOME), sourceLabel)

/** Expenses grouped by vendor, largest first, capped. */
export const byVendorOf = (rows, vendorLabel, limit) =>
  groupSum(rows.filter((r) => r.type === TX.EXPENSE), vendorLabel).slice(0, limit)

/** Net movement per account. A transfer appears on both sides — the pair nets
 *  to zero overall, but still shows where money actually moved. */
export function byAccountOf(rows, accountLabel) {
  const m = {}
  const add = (id, v) => { if (id) m[id] = (m[id] || 0) + v }
  for (const r of rows) {
    const amt = toNumber(r.amount)
    if (r.type === TX.INCOME) add(r.account_id, amt)
    else if (r.type === TX.EXPENSE) add(r.account_id, -amt)
    else if (r.type === TX.TRANSFER) { add(r.account_id, -amt); add(r.to_account_id, amt) }
  }
  return Object.entries(m)
    .map(([id, value]) => ({ name: accountLabel(id), value }))
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
}

/** Largest expenses, capped. */
export const topExpensesOf = (rows, limit) =>
  rows.filter((r) => r.type === TX.EXPENSE)
    .sort((a, b) => toNumber(b.amount) - toNumber(a.amount))
    .slice(0, limit)

/** Spend against the season's budget allowance.
 *  Both sides must agree on which programs they cover: budgets are narrowed to
 *  what is on screen, while the spend charged to them is never program-filtered
 *  — a shared pot is drained by whoever drains it. */
export function overBudgetOf({ budgets, allRows, allLines, matchesTeam, allProgramsShown }) {
  const inScope = budgets.filter((b) => matchesTeam(b.team_scope))
  const overall = inScope.find((b) => !b.category_id)
  const total = overall ? toNumber(overall.amount) : inScope.reduce((s, b) => s + toNumber(b.amount), 0)
  const ids = new Set(inScope.map((b) => b.id))
  const spend = (overall && allProgramsShown)
    ? allRows.reduce((s, r) => s + (r.type === TX.EXPENSE ? toNumber(r.amount) : 0), 0)
    : allLines.reduce((s, l) => s + (ids.has(l.budget_id) ? toNumber(l.amount) : 0), 0)
  return { hasBudget: total > 0, over: Math.max(0, spend - total) }
}

/** Walks a category to its top-level ancestor, memoised per call. */
export function topAncestorNameFactory(categories, categoryName) {
  const byId = Object.fromEntries(categories.map((c) => [c.id, c]))
  const cache = {}
  return (id) => {
    if (!id) return null
    if (cache[id]) return cache[id]
    let cur = byId[id]
    if (!cur) return categoryName[id] || null
    while (cur.parent_id && byId[cur.parent_id]) cur = byId[cur.parent_id]
    cache[id] = cur.name
    return cur.name
  }
}
