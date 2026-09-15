import { roundMoney, toNumber } from './money'

/**
 * Re-applying a frozen simulation to today's data.
 *
 * A snapshot always displays what it displayed. Re-applying is a SEPARATE,
 * deliberate action — "this plan was made in September, what does it look like
 * now" — and its whole value is in being honest about what did not survive.
 *
 * Four outcomes per row, and they are genuinely different:
 *
 *   matched   still on the list, unchanged. Carries over silently.
 *   changed   still there, but the price or quantity moved. Carries over at the
 *             NEW figures, and says so — the point of re-applying is to see
 *             today's numbers, so silently keeping the old ones would defeat it.
 *   bought    the item has a transaction against it. Not a plan any more; it is
 *             spending, and counting it again would double it.
 *   missing   deleted, or cancelled. Nothing to carry.
 *
 * `bought` is separated from `missing` because they mean opposite things to the
 * reader: one is "this happened", the other is "this is gone". Merging them into
 * "could not apply" would make a completed purchase look like a loss.
 */
export function reapply(snapshotRows, liveItems) {
  const live = new Map((liveItems || []).map((i) => [i.id, i]))

  const matched = []
  const changed = []
  const bought = []
  const missing = []

  for (const snap of snapshotRows || []) {
    const item = snap.item_id ? live.get(snap.item_id) : null

    if (!item || item.status === 'cancelled') {
      missing.push(snap)
      continue
    }

    if (item.transaction_id || item.status === 'received') {
      bought.push({ ...snap, liveStatus: item.status })
      continue
    }

    const priceNow = toNumber(item.est_price)
    const qtyNow = item.quantity == null ? 1 : toNumber(item.quantity)
    const priceWas = toNumber(snap.est_price)
    const qtyWas = snap.quantity == null ? 1 : toNumber(snap.quantity)

    if (priceNow !== priceWas || qtyNow !== qtyWas) {
      changed.push({
        ...snap,
        est_price: priceNow,
        quantity: qtyNow,
        wasPrice: priceWas,
        wasQuantity: qtyWas,
        delta: roundMoney(priceNow * qtyNow - priceWas * qtyWas),
      })
      continue
    }

    matched.push(snap)
  }

  // What the re-applied scenario should actually select: everything still
  // buyable, at today's figures.
  const pickedIds = [...matched, ...changed].map((r) => r.item_id).filter(Boolean)

  return {
    matched,
    changed,
    bought,
    missing,
    pickedIds,
    // Difference between what the plan cost when saved and what it costs now,
    // counting only rows that still carry.
    deltaTotal: roundMoney(changed.reduce((s, r) => s + r.delta, 0)),
    // Nothing to report is worth knowing too — it means the plan is still exactly
    // as costed, which is the answer people are hoping for.
    clean: changed.length === 0 && bought.length === 0 && missing.length === 0,
  }
}

/** What the snapshot itself came to, at its own frozen figures. */
export function snapshotTotal(snapshotRows) {
  return roundMoney((snapshotRows || []).reduce(
    (s, r) => s + toNumber(r.est_price) * (r.quantity == null ? 1 : toNumber(r.quantity)), 0))
}
