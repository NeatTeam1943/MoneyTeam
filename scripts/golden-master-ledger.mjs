// Golden master for src/domain/ledger.js.
//
// REFERENCE blocks below are verbatim copies of the inline implementations
// that lived in Reports.jsx and Dashboard.jsx before extraction. Both are run
// against the real dataset for every program filter and every grouping, and
// the JSON must match exactly.

import fs from 'fs'
import {
  totalsOf, byMonthOf, cumulativeOf, byCategoryOf, bySourceOf, byVendorOf,
  byAccountOf, topExpensesOf, overBudgetOf, topAncestorNameFactory, groupSum,
} from '/tmp/ledger.bundle.mjs'

const D = JSON.parse(fs.readFileSync('/tmp/gm2.json', 'utf8'))

const monthKey = (d) => String(d).slice(0, 7)
const categoryName = Object.fromEntries(D.cats.map((c) => [c.id, c.name]))
const accountName = Object.fromEntries(D.accounts.map((a) => [a.id, a.name]))
const sourceName = Object.fromEntries(D.sources.map((s) => [s.id, s.name]))
const budgetCat = Object.fromEntries(D.budgets.map((b) => [b.id, b.category_id]))
const t = (k) => k
const TOP = 10

const mkTs = (picked) => {
  const p = new Set(picked); const all = p.has('frc') && p.has('ftc')
  return { all, matches: (s) => all || !s || s === 'both' || p.has(s) }
}

// ---------------------------------------------------------------- REFERENCE
const refTotals = (rows, ts) => {
  let income = 0, expense = 0, inkind = 0
  for (const r of rows) {
    if (r.type === 'income') income += Number(r.amount)
    else if (r.type === 'expense') expense += Number(r.amount)
    else if (r.type === 'in_kind') inkind += Number(r.amount)
  }
  return { income, expense, inkind, net: ts.all ? income - expense : null }
}
const refByMonth = (rows) => {
  const m = {}
  for (const r of rows) {
    if (r.type !== 'income' && r.type !== 'expense') continue
    const k = monthKey(r.date)
    m[k] = m[k] || { month: k, income: 0, expense: 0 }
    m[k][r.type] += Number(r.amount)
  }
  return Object.values(m).sort((a, b) => a.month.localeCompare(b.month))
}
const refCumulative = (byMonth) => {
  let run = 0
  return byMonth.map((m) => { run += m.income - m.expense; return { month: m.month, net: m.income - m.expense, cumulative: run } })
}
const refByCategory = (lines) => {
  const m = {}
  for (const l of lines) {
    const k = categoryName[budgetCat[l.budget_id]] || t('uncategorized')
    m[k] = (m[k] || 0) + Number(l.amount)
  }
  return Object.entries(m).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
}
const refBySource = (rows) => {
  const m = {}
  for (const r of rows) {
    if (r.type !== 'income') continue
    const k = sourceName[r.income_source_id] || '—'
    m[k] = (m[k] || 0) + Number(r.amount)
  }
  return Object.entries(m).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
}
const refByVendor = (rows) => {
  const m = {}
  for (const r of rows) {
    if (r.type !== 'expense') continue
    const k = r.vendor || t('uncategorized')
    m[k] = (m[k] || 0) + Number(r.amount)
  }
  return Object.entries(m).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, TOP)
}
const refByAccount = (rows) => {
  const m = {}
  const add = (id, v) => { if (id) m[id] = (m[id] || 0) + v }
  for (const r of rows) {
    const amt = Number(r.amount)
    if (r.type === 'income') add(r.account_id, amt)
    else if (r.type === 'expense') add(r.account_id, -amt)
    else if (r.type === 'transfer') { add(r.account_id, -amt); add(r.to_account_id, amt) }
  }
  return Object.entries(m).map(([id, value]) => ({ name: accountName[id] || '—', value }))
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
}
const refTopExpenses = (rows) =>
  rows.filter((r) => r.type === 'expense').sort((a, b) => Number(b.amount) - Number(a.amount)).slice(0, TOP)
const refOverBudget = (ts) => {
  const inScopeBudgets = D.budgets.filter((b) => ts.matches(b.team_scope))
  const overall = inScopeBudgets.find((b) => !b.category_id)
  const total = overall ? Number(overall.amount) : inScopeBudgets.reduce((s, b) => s + Number(b.amount), 0)
  const budgetIds = new Set(inScopeBudgets.map((b) => b.id))
  const spend = (overall && ts.all)
    ? D.tx.reduce((s, r) => s + (r.type === 'expense' ? Number(r.amount) : 0), 0)
    : D.lines.reduce((s, l) => s + (budgetIds.has(l.budget_id) ? Number(l.amount) : 0), 0)
  return { hasBudget: total > 0, over: Math.max(0, spend - total) }
}
const refTopAncestor = () => {
  const byId = Object.fromEntries(D.cats.map((c) => [c.id, c]))
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

// ---------------------------------------------------------------------- RUN
let checks = 0; let failures = 0
const eq = (label, a, b) => {
  checks++
  const same = JSON.stringify(a) === JSON.stringify(b)
  if (!same) { failures++; console.log(`  MISMATCH ${label}\n    ref: ${JSON.stringify(a).slice(0, 200)}\n    new: ${JSON.stringify(b).slice(0, 200)}`) }
  return same
}

for (const [name, picked] of [['both', ['frc', 'ftc']], ['FRC only', ['frc']], ['FTC only', ['ftc']]]) {
  const ts = mkTs(picked)
  const rows = D.tx.filter((r) => ts.matches(r.team_scope))
  const lines = D.lines.filter((l) => ts.matches(l.team_scope))

  eq(`totals/${name}`, refTotals(rows, ts), totalsOf(rows, ts.all))
  const rm = refByMonth(rows)
  eq(`byMonth/${name}`, rm, byMonthOf(rows, monthKey))
  eq(`cumulative/${name}`, refCumulative(rm), cumulativeOf(byMonthOf(rows, monthKey)))
  eq(`byCategory/${name}`, refByCategory(lines),
    byCategoryOf(lines, (l) => categoryName[budgetCat[l.budget_id]] || t('uncategorized')))
  eq(`bySource/${name}`, refBySource(rows), bySourceOf(rows, (r) => sourceName[r.income_source_id] || '—'))
  eq(`byVendor/${name}`, refByVendor(rows), byVendorOf(rows, (r) => r.vendor || t('uncategorized'), TOP))
  eq(`byAccount/${name}`, refByAccount(rows), byAccountOf(rows, (id) => accountName[id] || '—'))
  eq(`topExpenses/${name}`, refTopExpenses(rows), topExpensesOf(rows, TOP))
  eq(`overBudget/${name}`, refOverBudget(ts), overBudgetOf({
    budgets: D.budgets, allRows: D.tx, allLines: D.lines,
    matchesTeam: (s) => ts.matches(s), allProgramsShown: ts.all,
  }))

  // Dashboard's by-category uses the grouping toggle on top of the same roll-up
  const ancestorRef = refTopAncestor()
  const ancestorNew = topAncestorNameFactory(D.cats, categoryName)
  for (const grouping of ['direct', 'parent']) {
    const keyRef = (l) => {
      const catId = budgetCat[l.budget_id]
      return (grouping === 'parent' ? ancestorRef(catId) : categoryName[catId]) || t('overall')
    }
    const keyNew = (l) => {
      const catId = budgetCat[l.budget_id]
      return (grouping === 'parent' ? ancestorNew(catId) : categoryName[catId]) || t('overall')
    }
    const refG = (() => {
      const m = {}
      for (const l of lines) { const k = keyRef(l); m[k] = (m[k] || 0) + Number(l.amount) }
      return Object.entries(m).map(([n, v]) => ({ name: n, value: v })).sort((a, b) => b.value - a.value)
    })()
    eq(`dashByCategory/${grouping}/${name}`, refG, groupSum(lines, keyNew))
  }
}

console.log(`\n${checks} assertions, ${failures} mismatches`)
process.exit(failures ? 1 : 0)
