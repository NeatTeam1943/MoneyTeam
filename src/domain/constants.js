// Values that were previously inline literals scattered across components.
// Named here so a change happens in one place and each number can be argued
// with on its own terms.

/** Signed URL lifetime for a receipt, in seconds. Long enough to read a
 *  multi-page PDF, short enough that a copied link is not a lasting leak. */
export const RECEIPT_URL_TTL_SECONDS = 600

/** Above this, an image is not rendered inline without being asked.
 *  A PNG's file size is not what breaks a browser — its DECODED size is.
 *  3 MB of compressed PNG can be 6000x4000 px, which is ~96 MB in memory,
 *  well past what mobile Safari will decode. Rather than show a broken
 *  image icon, offer the choice. */
export const LARGE_IMAGE_BYTES = 2 * 1024 * 1024

/** Rows shown in "largest expenses". */
export const TOP_EXPENSES_LIMIT = 10

/** Bars shown in the by-vendor chart. */
export const TOP_VENDORS_LIMIT = 10

/** Supabase query ceiling used by the loaders. */
export const QUERY_TIMEOUT_MS = 15000

/** Percentage of a budget at which the burn-down bar changes tone. */
export const BUDGET_WARN_PCT = 80
export const BUDGET_OVER_PCT = 100

/** Decimal places money is rounded to before being stored or summed. */
export const MONEY_DP = 2

/** Programs. `BOTH` always matches either filter — that is what shared means. */
export const SCOPE = Object.freeze({ FRC: 'frc', FTC: 'ftc', BOTH: 'both' })
export const SCOPES = Object.freeze([SCOPE.FRC, SCOPE.FTC, SCOPE.BOTH])

/** Transaction types. */
export const TX = Object.freeze({
  INCOME: 'income', EXPENSE: 'expense', TRANSFER: 'transfer', IN_KIND: 'in_kind',
})

/** Shopping statuses. */
export const SHOPPING_STATUS = Object.freeze({
  WISH: 'wish',
  /** Raised, waiting for the finance lead to triage it. Where a new row starts
   *  — the column default, so this list's order is the only place the chain is
   *  written down. */
  WAITING_FINANCE: 'waiting_finance',
  /** Triaged, waiting for a MENTOR. The name is the original one and the data
   *  is untouched; what changed is that it no longer means "nobody has looked
   *  at this yet". The Hebrew label says "ממתין לאישור מנטור" so the two waits
   *  cannot be mistaken for each other on screen. */
  PENDING: 'pending_approval',
  WAITING_SPONSOR: 'waiting_sponsor',
  APPROVED: 'approved',
  ORDERED: 'ordered',
  RECEIVED: 'received',
  CANCELLED: 'cancelled',
})

/** The statuses offered in the dropdowns, in the order a request moves through
 *  them. `wish` is left out, as it was before this list was named: it is the
 *  column's default from before approvals existed, nothing creates one now,
 *  and offering it would only let a dead state back in. Rows that still carry
 *  it are shown and filtered normally. */
export const SELECTABLE_STATUSES = Object.freeze(
  Object.values(SHOPPING_STATUS).filter((s) => s !== SHOPPING_STATUS.WISH))

/** Statuses that still count as "waiting to be bought", and so as money the
 *  team has not yet found.
 *
 *  `waiting_finance` MUST be in here. It is the column default, so every new
 *  row lands in it; leaving it out would empty the "requested" total on the
 *  dashboard and the funding gap on the budgets page within a day, and the
 *  figure would look like a win rather than a bug. `waiting_sponsor` is in for
 *  the same kind of reason: a sponsor may still decline, and a gap that
 *  quietly shrinks is wrong in the dangerous direction. */
export const OPEN_STATUSES = Object.freeze([
  SHOPPING_STATUS.WAITING_FINANCE,
  SHOPPING_STATUS.PENDING,
  SHOPPING_STATUS.WAITING_SPONSOR,
  SHOPPING_STATUS.APPROVED,
])

/** Statuses a wish-list row can still be turned into a purchase from.
 *
 *  The same set as OPEN, by decision: a mentor seeing an obvious row should
 *  not have to walk it through triage before paying for it. Kept as its own
 *  name rather than an alias because the two answer different questions —
 *  "does this still cost us money" and "can I buy it right now" — and one is
 *  likely to narrow without the other. */
export const BUYABLE_STATUSES = Object.freeze([...OPEN_STATUSES])

/** The statuses a FINANCE LEAD may move a request into.
 *
 *  Triage, in other words: which queue is this in, or is it not happening.
 *  Approving, ordering and receiving are statements about money the team has
 *  committed and stay a mentor's to make.
 *
 *  This list is a copy of the one in guard_shopping_status() (migration 51),
 *  which is the real boundary — the app talks to PostgREST directly, so the
 *  UI only decides what is worth offering. If you change one, change both. */
export const FINANCE_LEAD_STATUSES = Object.freeze([
  SHOPPING_STATUS.WAITING_FINANCE,
  SHOPPING_STATUS.WAITING_SPONSOR,
  SHOPPING_STATUS.PENDING,
  SHOPPING_STATUS.CANCELLED,
])

/** Statuses that mean a mentor has already decided on the item. A finance lead
 *  cannot move a row OUT of one of these — cancelling an approved or paid-for
 *  item would be overruling that decision. Also mirrored in migration 51. */
export const MENTOR_DECIDED_STATUSES = Object.freeze([
  SHOPPING_STATUS.APPROVED,
  SHOPPING_STATUS.ORDERED,
  SHOPPING_STATUS.RECEIVED,
])

/** Which statuses this person may move the given row into — the single answer
 *  used by the row dropdown, the form and the bulk action, so the three cannot
 *  disagree. An empty list means the row is not theirs to move. */
export function allowedStatusesFor({ isMentor, isFinanceLead }, currentStatus) {
  if (isMentor) return SELECTABLE_STATUSES
  if (!isFinanceLead) return []
  if (MENTOR_DECIDED_STATUSES.includes(currentStatus)) return []
  return FINANCE_LEAD_STATUSES
}

/** What the shopping list shows before anyone touches the filter.
 *  Everything except the two that are finished with: a received item has
 *  arrived and a cancelled one is not happening, so neither is something you
 *  are still working through. Both remain one click away. */
export const DEFAULT_SHOPPING_STATUSES = Object.freeze(
  Object.values(SHOPPING_STATUS).filter(
    (s) => s !== SHOPPING_STATUS.RECEIVED && s !== SHOPPING_STATUS.CANCELLED))

/** Category roll-up modes for the budget chart. */
export const GROUPING = Object.freeze({ DIRECT: 'direct', PARENT: 'parent' })
