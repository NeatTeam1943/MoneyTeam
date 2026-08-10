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
