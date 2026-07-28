import { SCOPE, SHOPPING_STATUS, GROUPING } from './constants'
import { toNumber, lineTotalOf } from './money'

// Budget roll-up, extracted from Budgets.jsx unchanged.
//
// Kept as pure functions with no React and no Supabase so the arithmetic can
// be exercised directly against real data. The component decides what to
// render; this decides what the numbers are.

const OPEN_REQUEST_STATUSES = [SHOPPING_STATUS.PENDING, SHOPPING_STATUS.APPROVED]

/** Which categories a budget's figures may draw from.
 *  Overall (no category) under 'direct' means "charged to nothing specific",
 *  otherwise the toggle would be a no-op for that row. */
export function categoryPredicate(budget, grouping, descendants) {
  const isOverall = !budget.category_id
  if (grouping === GROUPING.DIRECT) {
    return isOverall ? (cid) => cid == null : (cid) => cid === budget.category_id
  }
  return isOverall ? () => true : (cid) => cid && descendants.has(cid)
}

/** Spend charged to a budget. Deliberately NOT filtered by program: a shared
 *  pot drained by one program has that much less in it regardless of which
 *  program is on screen. */
export function spentOn(expenses, inScope, budgetCategory) {
  return expenses.reduce((s, l) => s + (inScope(budgetCategory[l.budget_id]) ? toNumber(l.amount) : 0), 0)
}

/** The ticked programs' share of a shared pot — a secondary figure only,
 *  never the balance. Identical to `spent` for a single-program budget. */
export function spentInScopeOn(budget, expenses, inScope, budgetCategory, matchesTeam, allTicked) {
  if (budget.team_scope !== SCOPE.BOTH || allTicked) {
    return spentOn(expenses, inScope, budgetCategory)
  }
  return expenses.reduce((s, l) =>
    s + (inScope(budgetCategory[l.budget_id]) && matchesTeam(l.team_scope) ? toNumber(l.amount) : 0), 0)
}

/** Outstanding wish-list value against a budget. */
export function requestedOn(shopping, inScope) {
  return shopping.reduce((s, r) =>
    OPEN_REQUEST_STATUSES.includes(r.status) && inScope(r.category_id) ? s + lineTotalOf(r) : s, 0)
}

/** True when the child budgets under this one already exceed its own amount. */
export function childrenOverspend(budget, budgets, descendants) {
  if (!budget.category_id) return false
  const childSum = budgets.reduce((sum, x) =>
    (x.category_id && x.category_id !== budget.category_id && descendants.has(x.category_id))
      ? sum + toNumber(x.amount) : sum, 0)
  return childSum > toNumber(budget.amount)
}

const PCT_CEILING = 999

/** Overall first, then descending by amount. */
export const byOverallThenAmount = (a, b) =>
  (a.category_id ? 1 : 0) - (b.category_id ? 1 : 0) || b.amount - a.amount

/**
 * @param {object} deps  budgets, expenses, shopping, budgetCategory,
 *                       descendantsOf, categoryName, labelFor, matchesTeam, allTicked
 */
export function buildBudgetRows(grouping, deps) {
  const {
    budgets, expenses, shopping, budgetCategory,
    descendantsOf, labelFor, matchesTeam, allTicked,
  } = deps

  return budgets.map((b) => {
    const descendants = b.category_id ? descendantsOf(b.category_id) : null
    const inScope = categoryPredicate(b, grouping, descendants)
    const spent = spentOn(expenses, inScope, budgetCategory)
    const amount = toNumber(b.amount)
    return {
      ...b,
      label: labelFor(b),
      spent,
      spentInScope: spentInScopeOn(b, expenses, inScope, budgetCategory, matchesTeam, allTicked),
      requested: requestedOn(shopping, inScope),
      remaining: amount - spent,
      pct: amount > 0 ? Math.min(PCT_CEILING, (spent / amount) * 100) : 0,
      childOver: childrenOverspend(b, budgets, descendants),
    }
  }).sort(byOverallThenAmount)
}
