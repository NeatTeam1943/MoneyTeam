import { roundMoney, toNumber } from './money'

/**
 * What a report should lead with.
 *
 * A report that only totals things makes the reader do the work: scan every
 * budget, compare two columns, notice which ones matter. The figures that
 * change a decision — what is over, what is untouched, what moved — should be
 * at the top and impossible to miss.
 *
 * Ordered by MONEY, not by percentage. A pot 300% over by ₪90 is a rounding
 * error; one 12% over by ₪9,000 is the problem. Percentage is shown, but the
 * ordering follows the amount, because that is what has to be found first.
 */
export function reportAlerts(rows) {
  const over = []
  const unused = []

  for (const r of rows || []) {
    const amount = toNumber(r.amount)
    const spent = toNumber(r.spent)
    if (amount <= 0 && spent <= 0) continue

    if (spent > amount) {
      over.push({
        id: r.id,
        label: r.label,
        amount: roundMoney(amount),
        spent: roundMoney(spent),
        by: roundMoney(spent - amount),
        pct: amount > 0 ? roundMoney((spent / amount) * 100) : null,
      })
    } else if (amount > 0) {
      const left = amount - spent
      // "Barely touched" is a judgement, so the threshold is explicit rather
      // than hidden in a filter: under a quarter used, with real money left.
      if (spent / amount < 0.25 && left >= 500) {
        unused.push({
          id: r.id,
          label: r.label,
          amount: roundMoney(amount),
          spent: roundMoney(spent),
          left: roundMoney(left),
          pct: roundMoney((spent / amount) * 100),
        })
      }
    }
  }

  over.sort((a, b) => b.by - a.by)
  unused.sort((a, b) => b.left - a.left)

  return {
    over,
    unused,
    totalOver: roundMoney(over.reduce((s, x) => s + x.by, 0)),
    totalUnused: roundMoney(unused.reduce((s, x) => s + x.left, 0)),
    // Nothing to say is worth saying too — a report with no alerts should state
    // that, not just omit the section and look unfinished.
    clean: over.length === 0 && unused.length === 0,
  }
}
