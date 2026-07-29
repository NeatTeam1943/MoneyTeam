import { SCOPE } from './constants'

// Which pot pays for a purchase in this category.
//
// You choose the CATEGORY, because that is what you actually know at the till:
// "this is motors". The budget is then found by walking up the category tree
// to the nearest pot that covers it — a budget on "רובוט" pays for everything
// beneath it. Programs are respected on the way: an FRC line prefers an FRC
// budget and falls back to the shared one, never to the FTC one.
//
// The result is a SUGGESTION. It is pre-filled and always editable, because
// there are legitimate reasons to charge something elsewhere — a sponsor
// earmark, a one-off paid from a different pot. Automating the common case
// without taking away the override.

/** Budgets sitting directly on a category, most specific program first. */
function budgetsOn(categoryId, budgets) {
  return budgets.filter((b) => b.category_id === categoryId)
}

function pick(candidates, scope) {
  return candidates.find((b) => b.team_scope === scope)
    || candidates.find((b) => b.team_scope === SCOPE.BOTH)
    || null
}

/**
 * @returns {{ budget: object|null, via: string|null, exact: boolean }}
 *   `via` is the category the budget was found on — useful for telling the
 *   user "paid from רובוט" rather than silently picking something.
 */
export function resolveBudget(categoryId, teamScope, budgets, parentOf) {
  const scope = teamScope || SCOPE.BOTH
  let cur = categoryId
  let exact = true
  while (cur) {
    const hit = pick(budgetsOn(cur, budgets), scope)
    if (hit) return { budget: hit, via: cur, exact }
    cur = parentOf[cur]
    exact = false
  }
  // Nothing anywhere up the tree — fall back to the season's overall pot.
  const overall = pick(budgets.filter((b) => !b.category_id), scope)
  return { budget: overall, via: null, exact: false }
}
