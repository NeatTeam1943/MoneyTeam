import { roundMoney, toNumber } from './money'

/**
 * Where the season started, where it stands, and where it is heading.
 *
 * The projection is: what is in the accounts now, minus every shekel that is
 * budgeted and not yet spent. It answers "if we spend the whole plan, what is
 * left" — which is a different question from "are we over budget", and the one
 * nobody could answer before.
 *
 * ── Why committed spend, not spent ──────────────────────────────────────────
 *
 * A budget that is approved but untouched is money already promised. Counting
 * only what has LEFT the account makes a fully-budgeted season look healthy
 * right up to the week the invoices arrive.
 *
 * ── Simulation ──────────────────────────────────────────────────────────────
 *
 * In a simulation the same arithmetic takes the planned income and the planned
 * spend on top. That is where it earns its place: a plan that adds ₪40,000 of
 * expected sponsorship changes the year-end figure, and without this the
 * simulation could only show the effect on today's balance.
 *
 * An UNDER-spend of a budget is not income — money not spent was never
 * received. So planned income adds, planned spend subtracts, and the untouched
 * remainder of the budget stays committed either way.
 */
export function yearOutlook({
  opening = 0,
  balanceNow = 0,
  budgeted = 0,
  spent = 0,
  plannedIncome = 0,
  plannedSpend = 0,
} = {}) {
  const open = toNumber(opening)
  const now = toNumber(balanceNow)
  const plan = toNumber(budgeted)
  const out = toNumber(spent)

  // What the plan still allows. Floored at zero: an overspent budget has no
  // remaining commitment, and a negative one would quietly credit the
  // projection for going over — the opposite of the truth.
  const committed = Math.max(0, plan - out)

  const income = toNumber(plannedIncome)
  const sim = toNumber(plannedSpend)

  // Simulated income arrives, simulated spend leaves, and whatever the budget
  // still allows is subtracted whether or not the simulation touched it.
  const projected = now + income - sim - committed

  return {
    opening: roundMoney(open),
    balanceNow: roundMoney(now),
    committed: roundMoney(committed),
    projected: roundMoney(projected),
    // The season's movement so far, which is what makes `opening` worth
    // showing beside the rest rather than as a lone figure.
    changeSoFar: roundMoney(now - open),
    // Signed on purpose: a reader wants to know whether the plan ends the year
    // up or down on where it started, not merely the size of the gap.
    changeProjected: roundMoney(projected - open),
    shortfall: projected < 0 ? roundMoney(-projected) : 0,
  }
}
