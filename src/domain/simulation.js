import { toNumber, lineTotalOf } from './money'

// What-if projections, extracted from Simulation.jsx. Nothing here writes.

/** Balance per account after the planned spend and expected income.
 *  Each planned row is charged to its OWN funding account, so a basket split
 *  across two sources drains both instead of dumping the cost on one. */
export function projectAccounts({ balances, incomes, picked, extras, accountFor, defaultAccount }) {
  return balances.map((b) => {
    const incoming = incomes.reduce((s, r) => s + (r.account_id === b.id ? toNumber(r.amount) : 0), 0)
    const outgoing = picked.reduce((s, r) => s + (accountFor(r.id) === b.id ? lineTotalOf(r) : 0), 0)
      + extras.reduce((s, e) => s + ((e.account_id || defaultAccount) === b.id ? toNumber(e.amount) : 0), 0)
    const before = toNumber(b.balance)
    return { ...b, before, delta: incoming - outgoing, after: before + incoming - outgoing }
  })
}

/** Accounts that are solvent today and would not be after the plan. */
export const newlyNegative = (projected) => projected.filter((a) => a.after < 0 && a.before >= 0)

/** Budgets that are within their limit today and would not be after the plan. */
export const newlyOver = (projected) => projected.filter((b) => b.nowOver && !b.wasOver)

/** Projected burn per budget.
 *  `spent` is deliberately NOT program-filtered: a shared pot already consumed
 *  by the other program has that much less left, whichever program is being
 *  simulated. Filtering it would project money that is already gone. */
export function projectBudgets({ budgets, lines, picked, extras, budgetCategory, inScopeFor, labelFor }) {
  return budgets.map((b) => {
    const inScope = inScopeFor(b)
    const spent = lines.reduce((s, l) => s + (inScope(budgetCategory[l.budget_id]) ? toNumber(l.amount) : 0), 0)
    const planned = picked.reduce((s, r) => s + (inScope(r.category_id) ? lineTotalOf(r) : 0), 0)
      + extras.reduce((s, e) => s + (inScope(e.category_id) ? toNumber(e.amount) : 0), 0)
    const amount = toNumber(b.amount)
    const after = spent + planned
    return {
      id: b.id,
      label: labelFor(b),
      amount, spent, planned, after,
      remaining: amount - after,
      pct: amount > 0 ? (after / amount) * 100 : 0,
      wasOver: spent > amount && amount > 0,
      nowOver: after > amount && amount > 0,
    }
  })
}
