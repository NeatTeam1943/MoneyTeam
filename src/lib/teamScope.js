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
