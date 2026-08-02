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

/** Budgets that are within their limit today and would not be after the plan.
 *
 *  Only the MOST SPECIFIC budget in each affected chain is reported. A row in
 *  "אוכל" also pushes "תחרויות" and "כללי" over, because those contain it —
 *  that roll-up is correct and each row's own figures stay as they are. But
 *  listing all three as warnings turns one problem into three, and a reader
 *  counts warnings rather than tracing a budget hierarchy.
 *
 *  Reporting the innermost one is also the actionable one: it names the pot
 *  that actually has to change.
 */
export function newlyOver(projected, ownership) {
  const over = projected.filter((b) => b.nowOver && !b.wasOver)
  if (!ownership) return over
  const ids = new Set(over.map((b) => b.id))
  // Drop any budget that has a descendant already in the list.
  return over.filter((b) => !over.some((x) => {
    let p = ownership[x.id]
    while (p) { if (p === b.id) return true; p = ownership[p] }
    return false
  }) || !ids.size)
}

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

  const rows = budgets.map((b) => {
    const inScope = inScopeFor(b)
    const owned = ownership ? ownedBudgetIds(b.id, ownership) : null
    const absorbsUnattributed = ownership && !b.category_id

    const spent = owned
      ? lines.reduce((s, l) => {
        const eff = effectiveBudgetId(l)
        return s + ((owned.has(eff) || (absorbsUnattributed && eff == null)) ? toNumber(l.amount) : 0)
      }, 0)
      : lines.reduce((s, l) => s + (inScope(budgetCategory[l.budget_id]) ? toNumber(l.amount) : 0), 0)

    // Planned spend is attributed the same way real spend is: resolve the row
    // to ONE budget, then count it for that budget and its ancestors.
    //
    // It used to match on category, so a single ₪85,620 row in "אוכל" was
    // counted in full by אוכל, אוכל·FTC, תחרויות AND כללי — four budgets each
    // reporting a new overspend caused by the same one row. `spent` was moved
    // to the ownership model earlier; this half was left behind, so the two
    // halves of the same figure disagreed.
    const plannedOf = (row, amount) => {
      if (!ownership) return inScope(row.category_id) ? amount : 0
      const target = resolveBudget(row.category_id, row.team_scope, budgets, parentOf).budget?.id
      if (target) return owned?.has(target) ? amount : 0
      // Nothing covers that category: the overall pot absorbs it, exactly as
      // unattributable real spend is absorbed.
      return absorbsUnattributed ? amount : 0
    }
    const planned = picked.reduce((s, r) => s + plannedOf(r, lineTotalOf(r)), 0)
      + extras.reduce((s, e) => s + plannedOf(e, toNumber(e.amount)), 0)

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
  // Attached so callers can collapse a chain of warnings to its innermost
  // budget without rebuilding the ownership map themselves.
  rows.ownership = ownership
  return rows
}
