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
