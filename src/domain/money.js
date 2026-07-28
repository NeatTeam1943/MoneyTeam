import { MONEY_DP } from './constants'

const FACTOR = 10 ** MONEY_DP

/** Rounds to the stored precision. Kept in one place so every call site
 *  rounds identically — mixed rounding is how totals drift by agorot. */
export const roundMoney = (n) => Math.round((Number(n) || 0) * FACTOR) / FACTOR

export const toNumber = (v) => Number(v) || 0

/** A missing quantity defaults to 1; an explicit 0 stays 0. See qtyOf in
 *  lib/format.js for the bug this prevents. */
export const quantityOf = (row) => (row?.quantity == null ? 1 : Number(row.quantity) || 0)

export const lineTotalOf = (row) => toNumber(row?.est_price) * quantityOf(row)

export const sumBy = (rows, pick) => (rows || []).reduce((acc, r) => acc + toNumber(pick(r)), 0)
