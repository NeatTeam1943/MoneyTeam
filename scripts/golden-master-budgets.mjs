// Golden-master check for the Budgets refactor.
//
// REFERENCE is the original inline logic from Budgets.jsx, copied verbatim
// before the extraction. CANDIDATE is the extracted domain module. Both are
// run against the real production dataset, for every grouping and every
// program filter, and the JSON output must match exactly.
//
// This is the only thing that makes "refactor without changing behaviour" a
// claim rather than a hope.

import fs from 'fs'
import { buildBudgetRows } from '../src/domain/budgets.js'

const D = JSON.parse(fs.readFileSync(process.env.GM_DATA || '/tmp/gm.json', 'utf8'))

// ---- shared fixtures -------------------------------------------------------
const kids = {}
for (const c of D.cats) if (c.parent_id) (kids[c.parent_id] = kids[c.parent_id] || []).push(c.id)
const descendantsOf = (id) => {
  const acc = new Set([id]); const st = [id]
  while (st.length) { const c = st.pop(); for (const k of kids[c] || []) if (!acc.has(k)) { acc.add(k); st.push(k) } }
  return acc
}
const categoryName = Object.fromEntries(D.cats.map((c) => [c.id, c.name]))
const budgetCategory = Object.fromEntries(D.budgets.map((b) => [b.id, b.category_id]))
const lineTotal = (r) => (Number(r?.est_price) || 0) * (r?.quantity == null ? 1 : Number(r.quantity) || 0)
const t = (k) => (k === 'overall' ? 'OVERALL' : k === 'uncategorized' ? 'UNCAT' : k)
const labelFor = (b) => (!b.category_id ? t('overall') : (categoryName[b.category_id] || t('uncategorized')))

const mkTs = (picked) => {
  const p = new Set(picked); const all = p.has('frc') && p.has('ftc')
  return { all, matches: (s) => all || !s || s === 'both' || p.has(s) }
}

// ---- REFERENCE: the original inline implementation --------------------------
function referenceRows(grouping, ts) {
  const scopedBudgets = D.budgets.filter((b) => ts.matches(b.team_scope))
  const scopedExpenses = D.lines
  const scopedShopping = D.shopping
  const matchesTeam = (scope) => ts.matches(scope)

  return scopedBudgets.map((b) => {
    const isOverall = !b.category_id
    const set = isOverall ? null : descendantsOf(b.category_id)
    const inScope = grouping === 'direct'
      ? (isOverall ? (cid) => cid == null : (cid) => cid === b.category_id)
      : (isOverall ? () => true : (cid) => cid && set.has(cid))
    const spent = scopedExpenses.reduce((s, l) => s + (inScope(budgetCategory[l.budget_id]) ? Number(l.amount) : 0), 0)
    const spentInScope = b.team_scope !== 'both' || ts.all ? spent
      : scopedExpenses.reduce((s, l) =>
        s + (inScope(budgetCategory[l.budget_id]) && matchesTeam(l.team_scope) ? Number(l.amount) : 0), 0)
    const requested = scopedShopping.reduce((s, r) => {
      if (r.status !== 'pending_approval' && r.status !== 'approved') return s
      return s + (inScope(r.category_id) ? lineTotal(r) : 0)
    }, 0)
    return {
      ...b,
      label: isOverall ? t('overall') : (categoryName[b.category_id] || t('uncategorized')),
      spent, spentInScope, requested,
      remaining: Number(b.amount) - spent,
      pct: b.amount > 0 ? Math.min(999, (spent / Number(b.amount)) * 100) : 0,
      childOver: (() => {
        if (isOverall) return false
        const childSum = scopedBudgets.reduce((sum, x) =>
          (x.category_id && x.category_id !== b.category_id && set.has(x.category_id))
            ? sum + Number(x.amount) : sum, 0)
        return childSum > Number(b.amount)
      })(),
    }
  }).sort((a, b) => (a.category_id ? 1 : 0) - (b.category_id ? 1 : 0) || b.amount - a.amount)
}

// ---- CANDIDATE: the extracted module ---------------------------------------
function candidateRows(grouping, ts) {
  return buildBudgetRows(grouping, {
    budgets: D.budgets.filter((b) => ts.matches(b.team_scope)),
    expenses: D.lines,
    shopping: D.shopping,
    budgetCategory,
    descendantsOf,
    labelFor,
    matchesTeam: (s) => ts.matches(s),
    allTicked: ts.all,
  })
}

// ---- run every combination --------------------------------------------------
let checks = 0; let failures = 0
for (const grouping of ['parent', 'direct']) {
  for (const [name, picked] of [['both', ['frc', 'ftc']], ['FRC only', ['frc']], ['FTC only', ['ftc']]]) {
    const ts = mkTs(picked)
    const a = JSON.stringify(referenceRows(grouping, ts))
    const b = JSON.stringify(candidateRows(grouping, ts))
    checks++
    const ok = a === b
    if (!ok) {
      failures++
      console.log(`  MISMATCH  grouping=${grouping} filter=${name}`)
      const ra = JSON.parse(a); const rb = JSON.parse(b)
      for (let i = 0; i < Math.max(ra.length, rb.length); i++) {
        if (JSON.stringify(ra[i]) !== JSON.stringify(rb[i])) {
          console.log('    reference:', JSON.stringify(ra[i]))
          console.log('    candidate:', JSON.stringify(rb[i]))
        }
      }
    } else {
      const rows = JSON.parse(a)
      const total = rows.reduce((s, r) => s + r.spent, 0)
      console.log(`  identical  grouping=${grouping.padEnd(6)} filter=${name.padEnd(8)} ` +
        `${String(rows.length).padStart(2)} rows, spent total ${total.toFixed(2)}`)
    }
  }
}
console.log(`\n${checks} combinations checked, ${failures} mismatches`)
process.exit(failures ? 1 : 0)
