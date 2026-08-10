import { roundMoney, toNumber } from './money'

/**
 * How a savings goal is doing.
 *
 * `available` is the money actually in the accounts. A goal's progress is the
 * smaller of what has been explicitly reserved for it and what exists — a goal
 * cannot be further along than the team's actual cash, however much someone
 * has earmarked on paper.
 *
 * Reserving more than exists is worth SAYING rather than silently capping,
 * because it usually means two goals have been promised the same shekel.
 */
export function goalProgress(goal, available) {
  const target = toNumber(goal.target)
  const reserved = toNumber(goal.reserved)
  const funded = Math.min(reserved, Math.max(0, available))
  const pct = target > 0 ? Math.min(999, (funded / target) * 100) : 0
  return {
    target: roundMoney(target),
    reserved: roundMoney(reserved),
    funded: roundMoney(funded),
    short: roundMoney(Math.max(0, target - funded)),
    pct: roundMoney(pct),
    met: funded >= target,
    // Earmarked beyond what the accounts hold.
    overReserved: reserved > Math.max(0, available),
  }
}

/**
 * Whether the goals as a set promise more than the team has.
 *
 * Each goal on its own can look healthy while the total reserved exceeds the
 * balance — that is exactly the mistake a goals page should catch, so it is
 * computed across all of them rather than per row.
 */
export function goalsSummary(goals, available) {
  const reserved = roundMoney((goals || []).reduce((s, g) => s + toNumber(g.reserved), 0))
  const target = roundMoney((goals || []).reduce((s, g) => s + toNumber(g.target), 0))
  return {
    count: (goals || []).length,
    target,
    reserved,
    unreserved: roundMoney(Math.max(0, available - reserved)),
    overCommitted: roundMoney(Math.max(0, reserved - available)),
    stillNeeded: roundMoney(Math.max(0, target - reserved)),
  }
}

/** Days left, or null when the goal has no date. Negative means overdue. */
export function daysUntil(dateStr, today = new Date()) {
  if (!dateStr) return null
  const d = new Date(dateStr)
  if (Number.isNaN(d.getTime())) return null
  return Math.round((d - today) / 86400000)
}

/**
 * Money that is free to spend: the balance less what goals have reserved.
 *
 * Deliberately NOT modelled as a budget or as a request. Those words already
 * mean specific things — a budget is a ceiling on spending, a request is an
 * item waiting on the shopping list — and folding reserved money into either
 * would move numbers nobody changed: "total planned budget" would grow without
 * anyone raising a ceiling, and overspend would shift because its denominator
 * moved. A goal is also not an item, and the shopping list is where requests
 * come from, so it cannot honestly be counted there either.
 *
 * Reserved is a third quantity, and the honest way to show it is to subtract it
 * from what is spendable and say so.
 */
export function spendableAfterGoals(balance, goals) {
  const reserved = (goals || []).reduce((s, g) => s + (Number(g.reserved) || 0), 0)
  const bal = Number(balance) || 0
  return {
    balance: bal,
    reserved,
    // Never negative: a naive subtraction would print a negative amount of
    // money that can be spent, which is not a thing.
    available: Math.max(0, bal - reserved),
    overReserved: reserved > bal,
  }
}

/**
 * Whether a plan would eat into money set aside for goals.
 *
 * Not a block: a team may legitimately decide a purchase matters more than a
 * goal. But it must be a decision rather than an accident, which means the
 * screen has to say it.
 */
export function goalImpact(plannedSpend, balance, goals) {
  const { available, reserved } = spendableAfterGoals(balance, goals)
  const spend = Number(plannedSpend) || 0
  return {
    available,
    reserved,
    intrudes: spend > available,
    intrusion: Math.max(0, spend - available),
  }
}

/**
 * How each goal stands once a plan is carried out.
 *
 * The simulation could already say "this plan eats into reserved money by X",
 * which names a number and no goal. Planning is the moment someone chooses
 * between a purchase and a goal, and that choice needs the goals in front of
 * them: which ones survive the plan, which get delayed, and — when a plan
 * leaves money over — which goal that surplus would complete.
 *
 * Reservations are reduced in list order rather than pro rata. Splitting a
 * shortfall evenly across goals would be arithmetic nobody decided: if the
 * money runs short someone picks which goal waits, and showing the first ones
 * intact makes that choice visible instead of quietly degrading all of them.
 */
export function goalsAfterPlan(goals, balance, plannedSpend) {
  const bal = Number(balance) || 0
  const spend = Number(plannedSpend) || 0
  const left = Math.max(0, bal - spend)

  let remaining = left
  const rows = (goals || []).map((g) => {
    const reserved = Number(g.reserved) || 0
    const target = Number(g.target) || 0
    const stillHeld = Math.min(reserved, remaining)
    remaining -= stillHeld
    return {
      id: g.id,
      name: g.name,
      target,
      reservedBefore: reserved,
      reservedAfter: stillHeld,
      lost: reserved - stillHeld,
      // A goal is only "met" if what remains actually covers it.
      metAfter: stillHeld >= target && target > 0,
      shortAfter: Math.max(0, target - stillHeld),
    }
  })

  return {
    cashAfterPlan: left,
    rows,
    // Money the plan leaves that no goal has claimed — the figure that answers
    // "could we also start saving for X".
    unclaimed: Math.max(0, remaining),
    harmed: rows.filter((r) => r.lost > 0),
  }
}

/**
 * What reserving does to the budget picture.
 *
 * A budget is a CEILING — permission to spend — and it knows nothing about how
 * much money exists. Reserving does not lower any ceiling, so the budgets page
 * keeps reporting the same "remaining" while the cash behind it has been
 * spoken for. That gap is invisible today and is the thing worth naming:
 *
 *     budgets say you may still spend   15,000
 *     cash left after reservations       8,631
 *     -> 6,368 of that permission is not funded
 *
 * Deliberately NOT done by lowering the budgets. A budget is a decision someone
 * made about priorities; silently shrinking it because a goal was created would
 * rewrite that decision and make overspend figures move on their own. The
 * ceiling stays; what changes is that the screen now says how much of it the
 * bank can actually cover.
 */
export function budgetFundingGap(budgetRemaining, balance, goals) {
  const remaining = Math.max(0, Number(budgetRemaining) || 0)
  const reserved = (goals || []).reduce((s, g) => s + (Number(g.reserved) || 0), 0)
  const bal = Number(balance) || 0
  const spendable = Math.max(0, bal - reserved)
  return {
    budgetRemaining: remaining,
    reserved,
    spendable,
    // Permission that no money stands behind.
    unfunded: Math.max(0, remaining - spendable),
    // True when the budgets alone already exceed the cash, before any goal —
    // worth telling apart, because reserving is then not the cause.
    unfundedWithoutGoals: Math.max(0, remaining - bal),
  }
}
