import { roundMoney, toNumber } from './money'

// The working behind a budget figure (issue #3).
//
// Rows are quantity × unit price with a label: "FTC comp food per kid, 18, 45".
// No category — the calculator belongs to one budget and the category is
// already the budget's. Adding one would let the two disagree.

export const emptyCalcRow = () => ({ label: '', qty: '', unit: '' })

export const rowTotal = (r) => roundMoney(toNumber(r?.qty) * toNumber(r?.unit))

export const calcTotal = (rows) => roundMoney((rows || []).reduce((s, r) => s + rowTotal(r), 0))

/** Rows worth storing: a label or a number. Blank rows are dropped so an
 *  untouched calculator saves as [] rather than a row of empty strings. */
export const cleanCalc = (rows) => (rows || [])
  .filter((r) => String(r.label || '').trim() || toNumber(r.qty) || toNumber(r.unit))
  .map((r) => ({ label: String(r.label || '').trim(), qty: toNumber(r.qty), unit: toNumber(r.unit) }))

/**
 * Whether the stored amount still matches its working.
 *
 * Not an error — rounding ₪1,847 up to ₪2,000 is a normal decision, and the
 * amount stays authoritative either way. But the difference should be visible,
 * so a calculation edited and never re-applied cannot quietly describe a
 * number it no longer produces.
 */
export function calcStatus(amount, rows) {
  const clean = cleanCalc(rows)
  if (!clean.length) return { hasCalc: false, total: 0, matches: true, diff: 0 }
  const total = calcTotal(clean)
  const diff = roundMoney(toNumber(amount) - total)
  return { hasCalc: true, total, matches: diff === 0, diff }
}
