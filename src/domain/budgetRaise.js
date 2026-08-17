import { roundMoney, toNumber } from './money'

/**
 * A raise and an overspend are different things, and the app must not blur
 * them.
 *
 *   A RAISE is a decision: the first estimate was wrong, or there is more money
 *   to allocate and this is where it should go. It moves the ceiling.
 *
 *   AN OVERSPEND is a fact: more was spent than was allocated. Nothing blocks
 *   it, and raising the budget afterwards does NOT undo it — the money still
 *   went out, and the reports still say so.
 *
 * Being over therefore does not block a request. But the form has to say which
 * one is happening, or "raise the budget" quietly becomes how an overspend is
 * made to disappear from the screen.
 */
export function raiseContext(budget, spent) {
  const amount = toNumber(budget?.amount)
  const used = toNumber(spent)
  const over = Math.max(0, used - amount)
  return {
    amount: roundMoney(amount),
    spent: roundMoney(used),
    isOver: over > 0,
    over: roundMoney(over),
    // The amount that would exactly cover what has already gone out. Offered as
    // a starting point, never filled in automatically: choosing it is the
    // decision, and pre-filling it would make the overspend look like the
    // reason for the raise.
    coversOverspend: roundMoney(Math.max(amount, used)),
  }
}

/**
 * Whether a proposed figure is a real change.
 *
 * Either direction counts. Refusing a DECREASE was a mistake: while budgets are
 * locked, an amount that turns out too high had no route at all — the
 * over-allocated money stayed committed, distorted "remaining", and freeing it
 * meant unlocking for everyone.
 *
 * Only "no change" is refused, because a request that changes nothing is a
 * mistake rather than a decision.
 */
export function validateRaise(newAmount, current) {
  const next = toNumber(newAmount)
  const now = toNumber(current)
  if (!(next > 0)) return { ok: false, key: 'raiseMustBePositive' }
  if (next === now) return { ok: false, key: 'raiseSameAmount' }
  return {
    ok: true,
    delta: roundMoney(next - now),
    // The caller shows a different sentence for each direction; deriving it
    // here keeps that decision out of the component.
    direction: next > now ? 'increase' : 'decrease',
  }
}
