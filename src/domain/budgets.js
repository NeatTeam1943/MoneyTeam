import { SCOPE, SHOPPING_STATUS, GROUPING } from './constants'
import { toNumber, lineTotalOf } from './money'
import { buildOwnership, ownedBudgetIds, directBudgetIds } from './budgetOwnership'

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
// Sibling budgets on one category are three views of one pot. After a split
// there is no single "רובוט" row left, yet the whole is what a mentor still
// asks about. Group them: one row for the category carrying the combined
// figures, with each program underneath. Nothing is hidden and nothing has to
// be re-summed by hand.
export function groupSiblings(rows) {
  const byCategory = {}
  for (const r of rows) {
    const key = r.category_id || '__overall__'
    ;(byCategory[key] = byCategory[key] || []).push(r)
  }
  const out = []
  for (const r of rows) {
    const key = r.category_id || '__overall__'
    const family = byCategory[key]
    if (!family || family.length < 2) { out.push({ ...r, parts: null }); continue }
    if (family[0].id !== r.id) continue          // emit the family once
    const sum = (pick) => family.reduce((s, x) => s + pick(x), 0)
    const amount = sum((x) => x.amount)
    const spent = sum((x) => x.spent)
    out.push({
      ...r,
      id: `group:${key}`,
      team_scope: 'both',
      isGroup: true,
      amount,
      spent,
      spentInScope: sum((x) => x.spentInScope),
      requested: sum((x) => x.requested),
      remaining: amount - spent,
      pct: amount > 0 ? Math.min(999, (spent / amount) * 100) : 0,
      parts: family.map((x) => ({ ...x, parts: null })),
    })
  }
  return out
}

export function buildBudgetRows(grouping, deps) {
  const {
    budgets, expenses, shopping, budgetCategory,
    descendantsOf, labelFor, matchesTeam, allTicked, parentOf,
  } = deps

  // Spend is attributed through the ownership tree, so a line lands on exactly
  // one budget and rolls up exactly one chain. Requests are still matched by
  // category, because a wish-list item names a category and has no budget yet.
  const ownership = parentOf ? buildOwnership(budgets, parentOf) : null

  return budgets.map((b) => {
    const descendants = b.category_id ? descendantsOf(b.category_id) : null
    const inScope = categoryPredicate(b, grouping, descendants)
    const owned = ownership
      ? (grouping === GROUPING.DIRECT ? directBudgetIds(b.id) : ownedBudgetIds(b.id, ownership))
      : null
    const spent = owned
      ? expenses.reduce((s, l) => s + (owned.has(l.budget_id) ? toNumber(l.amount) : 0), 0)
      : spentOn(expenses, inScope, budgetCategory)
    // The ticked programs' share of a shared pot — a secondary figure, never
    // the balance.
    const spentInScope = owned
      ? (b.team_scope !== SCOPE.BOTH || allTicked
        ? spent
        : expenses.reduce((s, l) =>
          s + (owned.has(l.budget_id) && matchesTeam(l.team_scope) ? toNumber(l.amount) : 0), 0))
      : spentInScopeOn(b, expenses, inScope, budgetCategory, matchesTeam, allTicked)
    const amount = toNumber(b.amount)
    return {
      ...b,
      label: labelFor(b),
      spent,
      spentInScope,
      requested: requestedOn(shopping, inScope),
      remaining: amount - spent,
      pct: amount > 0 ? Math.min(PCT_CEILING, (spent / amount) * 100) : 0,
      childOver: childrenOverspend(b, budgets, descendants),
    }
  }).sort(byOverallThenAmount)
}
