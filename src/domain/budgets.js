import { SCOPE, SHOPPING_STATUS, GROUPING } from './constants'
import { toNumber, lineTotalOf, roundMoney } from './money'
import { buildOwnership, ownedBudgetIds, directBudgetIds } from './budgetOwnership'
import { resolveBudget } from './budgetResolver'

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
/** True when the budgets this one owns already allocate more than it holds.
 *
 *  The old version summed every budget on a descendant CATEGORY, whatever its
 *  program. Once a category carries an FRC, an FTC and a shared pot, a single
 *  parent pot is naturally smaller than all of them together, so the warning
 *  fired on healthy budgets — under an FTC view it counted FRC children whose
 *  money belongs to the FRC parent and which were not even on screen.
 *
 *  Ownership answers it exactly: only the budgets that actually roll into this
 *  one are counted. */
export function childrenOverspend(budget, budgets, descendants, ownership) {
  if (!budget.category_id) return false
  if (ownership) {
    const childSum = budgets.reduce((sum, x) =>
      (x.id !== budget.id && ownership[x.id] === budget.id) ? sum + toNumber(x.amount) : sum, 0)
    return childSum > toNumber(budget.amount)
  }
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
      amount: roundMoney(amount),
      spent: roundMoney(spent),
      spentInScope: roundMoney(sum((x) => x.spentInScope)),
      requested: roundMoney(sum((x) => x.requested)),
      remaining: roundMoney(amount - spent),
      pct: amount > 0 ? Math.min(999, roundMoney((spent / amount) * 100)) : 0,
      // The group row is built from `...r`, i.e. the FIRST sibling — so its
      // `calc` was one program's working shown against the COMBINED amount.
      // With FRC on 17,500 and FTC on 6,600 the panel listed only the FRC rows
      // and then called the 24,100 total a mismatch.
      //
      // Every sibling's working, each labelled with its program, and the
      // comparison is against the combined total. A part with no working of
      // its own contributes nothing rather than being counted as zero.
      calc: family.flatMap((x) => (x.calc || []).map((c) => ({
        ...c,
        program: x.team_scope,
      }))),
      // Which parts actually have working, so the panel can say when a total
      // is short because a sibling was never filled in — rather than implying
      // the arithmetic is wrong.
      calcParts: family.filter((x) => (x.calc || []).length).length,
      partCount: family.length,
      parts: family.map((x) => ({ ...x, parts: null })),
    })
  }
  return out
}

export function buildBudgetRows(grouping, deps) {
  const {
    budgets, expenses, shopping, budgetCategory,
    descendantsOf, labelFor, matchesTeam, allTicked, parentOf,
    // Every budget in the season, filtered or not. The program checklist
    // decides what is DISPLAYED; it must not change how full a pot is. Building
    // ownership from the visible subset alone detached the FRC children from
    // the overall pot, so under an FTC view "כללי" reported ₪59,468 of
    // ₪119,695 — half the season's spending vanished from the one figure that
    // is supposed to cover all of it.
    allBudgets,
  } = deps
  const ownershipSource = allBudgets || budgets

  // Spend is attributed through the ownership tree, so a line lands on exactly
  // one budget and rolls up exactly one chain. Requests are still matched by
  // category, because a wish-list item names a category and has no budget yet.
  const ownership = parentOf ? buildOwnership(ownershipSource, parentOf) : null

  // A line whose budget was deleted keeps its amount and its category — the
  // foreign key is ON DELETE SET NULL, so nothing is lost — but it stops
  // belonging to any budget, and every budget total silently drops by that
  // much. Deleting the motors budget made ₪17,819.20 disappear from the
  // Budgets page while sitting untouched in the ledger.
  //
  // Since migration 21 the line still says what it was FOR, so the pot that
  // covers that category can be found the same way the form finds it. An
  // orphaned line falls back to its parent budget instead of nowhere.
  const effectiveBudgetId = (l) => {
    if (l.budget_id) return l.budget_id
    if (!parentOf || !l.category_id) return null
    return resolveBudget(l.category_id, l.team_scope, ownershipSource, parentOf).budget?.id ?? null
  }

  return budgets.map((b) => {
    const descendants = b.category_id ? descendantsOf(b.category_id) : null
    const inScope = categoryPredicate(b, grouping, descendants)
    const owned = ownership
      ? (grouping === GROUPING.DIRECT ? directBudgetIds(b.id) : ownedBudgetIds(b.id, ownership))
      : null
    // Spend that resolves to no budget at all — no budget_id and no category
    // to find one from — still exists. The overall pot absorbs it in the
    // rolled-up view so that the money appears somewhere rather than being
    // quietly dropped from every total on the page.
    const absorbsUnattributed = !b.category_id && grouping !== GROUPING.DIRECT
    const spent = owned
      ? expenses.reduce((s, l) => {
        const eff = effectiveBudgetId(l)
        const counts = owned.has(eff) || (absorbsUnattributed && eff == null)
        return s + (counts ? toNumber(l.amount) : 0)
      }, 0)
      : spentOn(expenses, inScope, budgetCategory)
    // The ticked programs' share of a shared pot — a secondary figure, never
    // the balance.
    const spentInScope = owned
      ? (b.team_scope !== SCOPE.BOTH || allTicked
        ? spent
        : expenses.reduce((s, l) =>
          s + (((owned.has(effectiveBudgetId(l)) || (absorbsUnattributed && effectiveBudgetId(l) == null))
            && matchesTeam(l.team_scope)) ? toNumber(l.amount) : 0), 0))
      : spentInScopeOn(b, expenses, inScope, budgetCategory, matchesTeam, allTicked)
    const amount = toNumber(b.amount)
    return {
      ...b,
      label: labelFor(b),
      // Every figure is rounded to the agora before it leaves. spent is a sum
      // of many floats, so amount - spent lands at -1.45e-11 rather than 0 for
      // a budget that is exactly used up — small enough to be invisible, large
      // enough to render as "-0.00" in red beside an identical budget showing
      // "0.00" in green.
      spent: roundMoney(spent),
      spentInScope: roundMoney(spentInScope),
      requested: roundMoney(requestedOn(shopping, inScope)),
      remaining: roundMoney(amount - spent),
      pct: amount > 0 ? Math.min(PCT_CEILING, roundMoney((spent / amount) * 100)) : 0,
      childOver: childrenOverspend(b, ownershipSource, descendants, ownership),
    }
  }).sort(byOverallThenAmount)
}
