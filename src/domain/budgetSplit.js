import { SCOPE } from './constants'
import { toNumber, roundMoney } from './money'

// Splitting one budget into per-program budgets.
//
// Three pots, not two. A shared purchase — tape, fasteners, a tool both
// programs use — needs somewhere to go. Without a shared pot it silently rolls
// up to the parent budget, which is not wrong but is invisible, and invisible
// is how people end up surprised.
//
// Three rules keep the operation honest:
//
//   1. VALUE PRESERVING. The parts sum to the original, to the agora. A split
//      redistributes a ceiling; it must never quietly raise or lower it.
//   2. LINES FOLLOW THEIR PROGRAM. Spend already charged to the original moves
//      to the pot for its own team_scope, so each program's "used" figure is
//      right the moment the split lands rather than after a manual cleanup.
//   3. REVERSIBLE. Merging back restores exactly one budget with the original
//      total and every line pointing at it again.

/**
 * @param {object} budget      the budget being split
 * @param {number} frcAmount   ceiling for FRC
 * @param {number} ftcAmount   ceiling for FTC
 * @returns {{ parts: object[], sharedAmount: number, valid: boolean, error: string|null }}
 *   `parts` are plain objects ready to insert; the original is replaced by the
 *   shared part so nothing is orphaned.
 */
export function planSplit(budget, frcAmount, ftcAmount) {
  const total = toNumber(budget.amount)
  const frc = roundMoney(frcAmount)
  const ftc = roundMoney(ftcAmount)
  const shared = roundMoney(total - frc - ftc)

  if (frc < 0 || ftc < 0) {
    return { parts: [], sharedAmount: 0, valid: false, error: 'negative' }
  }
  if (shared < 0) {
    // The two programs were given more than the budget holds. Refusing is the
    // point: silently inflating the ceiling is exactly the lie to avoid.
    return { parts: [], sharedAmount: shared, valid: false, error: 'exceedsTotal' }
  }

  const base = { season_id: budget.season_id, category_id: budget.category_id }
  return {
    parts: [
      { ...base, team_scope: SCOPE.FRC, amount: frc },
      { ...base, team_scope: SCOPE.FTC, amount: ftc },
      { ...base, team_scope: SCOPE.BOTH, amount: shared },
    ],
    sharedAmount: shared,
    valid: true,
    error: null,
  }
}

/** Which new pot each existing line should be charged to after the split. */
export function reassignLines(lines, partIdByScope) {
  return lines.map((l) => ({
    ...l,
    budget_id: partIdByScope[l.team_scope || SCOPE.BOTH] ?? partIdByScope[SCOPE.BOTH],
  }))
}

/** Undoing a split: one budget again, holding the combined total. */
export function planMerge(parts) {
  return {
    amount: roundMoney(parts.reduce((s, p) => s + toNumber(p.amount), 0)),
    team_scope: SCOPE.BOTH,
  }
}
