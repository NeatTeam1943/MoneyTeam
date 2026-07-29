import { toNumber, lineTotalOf, roundMoney } from './money'
import { buildOwnership, ownedBudgetIds } from './budgetOwnership'
import { resolveBudget } from './budgetResolver'

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
export function projectBudgets({
  budgets, lines, picked, extras, budgetCategory, inScopeFor, labelFor, parentOf,
}) {
  // Spend is attributed exactly as the Budgets page attributes it: a line
  // counts against the budget it was charged to and rolls up one chain.
  //
  // This used to match on CATEGORY, which was fine while a category held one
  // budget. Once FRC, FTC and shared pots share a category, every one of them
  // absorbed the whole category's spend — so each showed the others' money and
  // the percentages ran to 498%, 1176%, 7742%. The Budgets page was fixed for
  // this; the simulation was not, and drifted apart from it.
  //
  // Planned spend still matches on category, because a wish-list item names a
  // category and has no budget yet — that is the question the simulation asks.
  const ownership = parentOf ? buildOwnership(budgets, parentOf) : null

  const effectiveBudgetId = (l) => {
    if (l.budget_id) return l.budget_id
    if (!parentOf || !l.category_id) return null
    return resolveBudget(l.category_id, l.team_scope, budgets, parentOf).budget?.id ?? null
  }

  return budgets.map((b) => {
    const inScope = inScopeFor(b)
    const owned = ownership ? ownedBudgetIds(b.id, ownership) : null
    const absorbsUnattributed = ownership && !b.category_id

    const spent = owned
      ? lines.reduce((s, l) => {
        const eff = effectiveBudgetId(l)
        return s + ((owned.has(eff) || (absorbsUnattributed && eff == null)) ? toNumber(l.amount) : 0)
      }, 0)
      : lines.reduce((s, l) => s + (inScope(budgetCategory[l.budget_id]) ? toNumber(l.amount) : 0), 0)

    const planned = picked.reduce((s, r) => s + (inScope(r.category_id) ? lineTotalOf(r) : 0), 0)
      + extras.reduce((s, e) => s + (inScope(e.category_id) ? toNumber(e.amount) : 0), 0)

    const amount = toNumber(b.amount)
    const after = spent + planned
    return {
      id: b.id,
      label: labelFor(b),
      amount: roundMoney(amount),
      spent: roundMoney(spent),
      planned: roundMoney(planned),
      after: roundMoney(after),
      remaining: roundMoney(amount - after),
      pct: amount > 0 ? roundMoney((after / amount) * 100) : 0,
      wasOver: roundMoney(spent - amount) > 0 && amount > 0,
      nowOver: roundMoney(after - amount) > 0 && amount > 0,
    }
  })
}
