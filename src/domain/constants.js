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
  PENDING: 'pending_approval',
  APPROVED: 'approved',
  ORDERED: 'ordered',
  RECEIVED: 'received',
  CANCELLED: 'cancelled',
})

/** Statuses a wish-list row can still be turned into a purchase from. */
export const BUYABLE_STATUSES = Object.freeze([SHOPPING_STATUS.PENDING, SHOPPING_STATUS.APPROVED])

/** Statuses that still count as "waiting to be bought". */
export const OPEN_STATUSES = BUYABLE_STATUSES

/** Category roll-up modes for the budget chart. */
export const GROUPING = Object.freeze({ DIRECT: 'direct', PARENT: 'parent' })
