/**
 * Has this date arrived yet?
 *
 * The same rule as migration 57, written once on this side. A transaction
 * dated ahead — a post-dated cheque, most often — is committed money that has
 * not landed: it is outside the balance, and the row is drawn muted so the
 * list says so at a glance.
 */

/**
 * Today, in the form the rows store: YYYY-MM-DD, by the LOCAL calendar.
 *
 * Deliberately not `new Date().toISOString().slice(0, 10)`, which is the
 * obvious one-liner and is wrong here. toISOString converts to UTC first, and
 * Israel is AHEAD of UTC — so between midnight and 02:00 (03:00 in summer)
 * UTC is still on yesterday's date. A cheque due today would be drawn as "not
 * yet arrived" for the first hours of its own day, and the row would disagree
 * with the balance, which cuts at the Israeli date (migration 57 does the
 * same correction on the SQL side, for the same reason).
 *
 * A transaction's date is a plain calendar date carrying no time zone at all,
 * so the only thing it can honestly be compared against is the local calendar
 * date.
 */
export function todayLocal(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
}

/**
 * True when `date` is still ahead. Today counts as arrived — the money is due
 * now, and the balance in migration 57 includes it with `<= today`, so both
 * sides have to agree about which way the boundary falls.
 *
 * Compared as strings: on YYYY-MM-DD that is exact, and it avoids building a
 * Date per row only to throw it away.
 */
export function notYetArrived(date, today = todayLocal()) {
  if (!date) return false
  return String(date).slice(0, 10) > today
}
