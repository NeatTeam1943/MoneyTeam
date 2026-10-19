import { MONEY_DP } from './constants'

const FACTOR = 10 ** MONEY_DP

/** Rounds to the stored precision. Kept in one place so every call site
 *  rounds identically — mixed rounding is how totals drift by agorot.
 *
 *  The `|| 0` is not decoration. Rounding a tiny negative gives NEGATIVE ZERO,
 *  which Intl still prints as "-0.00" and which reads as a deficit. -0 is
 *  falsy, so this collapses it to plain 0. Same for NaN. */
export const roundMoney = (n) => (Math.round((Number(n) || 0) * FACTOR) / FACTOR) || 0

export const toNumber = (v) => Number(v) || 0

/** A missing quantity defaults to 1; an explicit 0 stays 0. See qtyOf in
 *  lib/format.js for the bug this prevents. */
export const quantityOf = (row) => (row?.quantity == null ? 1 : Number(row.quantity) || 0)

export const lineTotalOf = (row) => toNumber(row?.est_price) * quantityOf(row)

/** What a transaction LINE is worth.
 *
 *  `amount` is authoritative — it is the column every balance, budget and
 *  report sums, and the one the database constrains. `unit_price` and
 *  `quantity` are how that number was arrived at, kept so a receipt can show
 *  the multiplication rather than just its result.
 *
 *  Falling back to the multiplication matters for exactly one case: a line
 *  written before those columns existed has neither, and every line written
 *  since has `amount` set from them by the form, so the two never disagree.
 *  A negative amount is a discount and is returned as-is, deliberately: the
 *  old `Number(x) || 0` style would have turned it into nothing. */
export const lineAmount = (line) => {
  if (line?.amount != null && line.amount !== '') return toNumber(line.amount)
  return toNumber(line?.unit_price) * quantityOf(line)
}

export const sumBy = (rows, pick) => (rows || []).reduce((acc, r) => acc + toNumber(pick(r)), 0)
