// Attributing money to a program.
//
// A single purchase can legitimately mix all three kinds — an FTC field part,
// an FRC motor and a shared roll of tape on one receipt. The transaction
// header therefore cannot say which program spent the money: for a mixed
// basket it is 'both', which is true of the purchase and useless as an
// accounting fact.
//
// So anything that reports "how much did FRC spend" must add up LINES, not
// transactions. Filtering whole transactions by their header either counts a
// mixed purchase in full for whichever program is ticked (overstating it) or
// drops it entirely (understating it) — both wrong, in opposite directions.
//
// Rows with no lines at all — income, transfers, in-kind, and any legacy
// expense saved before per-line marking existed — keep header semantics,
// because that is genuinely all the information there is about them.

export function linesByTransaction(lines) {
  const m = {}
  for (const l of lines || []) {
    const id = l.transaction_id
    if (!id) continue
    ;(m[id] = m[id] || []).push(l)
  }
  return m
}

// How much of this transaction belongs to the currently ticked programs.
// Returns a number between 0 and the full amount.
export function attributableAmount(tx, byTx, ts) {
  const own = byTx?.[tx.id]
  if (!own || !own.length) {
    return ts.matches(tx.team_scope) ? Number(tx.amount) || 0 : 0
  }
  const matched = own.reduce((s, l) => s + (ts.matches(l.team_scope) ? Number(l.amount) || 0 : 0), 0)
  // Lines should sum to the header, but a legacy row can be short. Never
  // report more than the transaction actually was.
  return Math.min(matched, Number(tx.amount) || 0)
}

// True when any part of the transaction concerns the ticked programs — used
// for "should this row be listed at all", which is a looser test than "how
// much of it counts".
export function touchesScope(tx, byTx, ts) {
  if (ts.all) return true
  const own = byTx?.[tx.id]
  if (!own || !own.length) return ts.matches(tx.team_scope)
  return own.some((l) => ts.matches(l.team_scope)) || ts.matches(tx.team_scope)
}

// Split of expense by program, counting each line under its own marking.
export function spendByScope(transactions, byTx) {
  const out = { frc: 0, ftc: 0, both: 0 }
  for (const tx of transactions) {
    if (tx.type !== 'expense') continue
    const own = byTx?.[tx.id]
    if (!own || !own.length) { out[tx.team_scope || 'both'] += Number(tx.amount) || 0; continue }
    for (const l of own) out[l.team_scope || 'both'] += Number(l.amount) || 0
  }
  return out
}

/**
 * Under a single-program filter, split what is on screen into the part that
 * belongs to that program ALONE and the part that is shared.
 *
 * "FRC spending is 11,000" is true but hides a decision: some of that is FRC's
 * own and some is a shared purchase that FTC benefits from equally. Those are
 * different facts, and only the first can be moved or cut without affecting the
 * other programme.
 *
 * It is also why two filtered views must never be added: the shared part
 * appears in both, so FRC + FTC exceeds the ledger by exactly `shared`.
 */
export function exclusiveVsShared(transactions, byTx, ts) {
  const program = ts.frc && !ts.ftc ? 'frc' : (ts.ftc && !ts.frc ? 'ftc' : null)
  if (!program) return null

  let exclusive = 0
  let shared = 0
  for (const tx of transactions) {
    if (tx.type !== 'expense') continue
    const own = byTx?.[tx.id]
    if (!own || !own.length) {
      // No lines: the header is all there is to go on.
      if (tx.team_scope === program) exclusive += Number(tx.amount) || 0
      else if (tx.team_scope === 'both') shared += Number(tx.amount) || 0
      continue
    }
    for (const l of own) {
      const amt = Number(l.amount) || 0
      if (l.team_scope === program) exclusive += amt
      else if (l.team_scope === 'both' || !l.team_scope) shared += amt
    }
  }
  return { program, exclusive, shared, total: exclusive + shared }
}
