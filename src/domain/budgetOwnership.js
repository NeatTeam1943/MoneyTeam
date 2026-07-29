import { SCOPE } from './constants'

// Which budget owns a given expense line.
//
// The old rule matched on CATEGORY: a line counted against any budget whose
// category subtree contained the line's budget's category. That was correct
// only while a category held at most one budget. The moment FRC and FTC each
// hold a budget on the same category — the whole point of migration 20 — both
// budgets absorbed every line, so each program saw the other's spending and
// the combined view counted the same shekel twice.
//
// The rule here makes ownership a partition: a line belongs to exactly one
// budget, and rolls up through exactly one chain of ancestors.
//
//   1. A line belongs to the budget it was charged to. That is not a guess —
//      transaction_lines.budget_id records it.
//   2. Roll-up: a budget also shows the totals of the budgets beneath it,
//      where "beneath" means the child budget's category is a descendant AND
//      this budget is that child's nearest scope-compatible ancestor.
//
// Scope compatibility, in preference order: a budget of the same program wins;
// a shared budget takes what is left. So an FRC child rolls into the FRC
// parent when one exists, and into the shared parent otherwise — never both.

/** Nearest ancestor category that carries at least one budget. */
function nearestBudgetedAncestor(categoryId, parentOf, budgetsByCategory) {
  let cur = parentOf[categoryId]
  while (cur) {
    if (budgetsByCategory[cur]?.length) return cur
    cur = parentOf[cur]
  }
  return null
}

/** Among the budgets on a category, the one that should absorb `scope`. */
function preferredParent(candidates, scope) {
  return candidates.find((b) => b.team_scope === scope)
    || candidates.find((b) => b.team_scope === SCOPE.BOTH)
    || null
}

/**
 * Maps every budget to its owning parent budget, forming a strict tree.
 * Budgets with no budgeted ancestor roll into the overall budget of their
 * scope, if one exists.
 */
export function buildOwnership(budgets, parentOf) {
  const byCategory = {}
  for (const b of budgets) {
    if (!b.category_id) continue
    ;(byCategory[b.category_id] = byCategory[b.category_id] || []).push(b)
  }
  const overall = budgets.filter((b) => !b.category_id)

  const parentBudget = {}
  for (const b of budgets) {
    if (!b.category_id) { parentBudget[b.id] = null; continue }
    const ancestorCat = nearestBudgetedAncestor(b.category_id, parentOf, byCategory)
    const candidates = ancestorCat
      ? byCategory[ancestorCat].filter((x) => x.id !== b.id)
      : overall
    parentBudget[b.id] = preferredParent(candidates, b.team_scope)?.id ?? null
  }
  return parentBudget
}

/** Every budget at or beneath `budgetId`, following the ownership tree. */
export function ownedBudgetIds(budgetId, parentBudget) {
  const children = {}
  for (const [id, parent] of Object.entries(parentBudget)) {
    if (parent) (children[parent] = children[parent] || []).push(id)
  }
  const out = new Set([budgetId])
  const stack = [budgetId]
  while (stack.length) {
    const cur = stack.pop()
    for (const kid of children[cur] || []) {
      if (!out.has(kid)) { out.add(kid); stack.push(kid) }
    }
  }
  return out
}

/** Lines charged to this budget only — used by the "direct" view. */
export const directBudgetIds = (budgetId) => new Set([budgetId])
