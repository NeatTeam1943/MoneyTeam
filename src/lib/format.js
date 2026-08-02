const ils = new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 2 })

// `+ 0` collapses negative zero. Without it, a value that rounds to -0 prints
// as "-0.00" — a deficit that does not exist. Belt and braces alongside
// roundMoney; this is the last point before a number reaches a person.
//
// The NO-BREAK space Intl puts between the digits and the ₪ (U+00A0) is
// replaced with an ordinary one. It is the only safe place the string can wrap:
// with the no-break space the whole thing had to stay on one line, so in a
// narrow card it overflowed and the ₪ was rendered outside the card entirely.
// Forcing CSS to break "anywhere" instead would let it split mid-number —
// "111,5 / 47.90" is worse than ugly, it is misreadable. Breaking before the
// symbol gives "111,547.90" then "₪", which nobody can misread.
export const money = (n) => ils.format((Number(n) || 0) + 0).replace(/\u00A0/g, ' ')
export const num = (n) => new Intl.NumberFormat('he-IL', { maximumFractionDigits: 2 }).format(Number(n || 0))

// A negative figure should read as negative at a glance — an account in
// overdraft or a budget blown past its limit is the thing you most need to
// see, and a minus sign alone is easy to miss in a wall of numbers.
// Compares on the rounded value, so a figure that is only negative below the
// agora is not painted as an overdraft.
export const amountColor = (n) => (((Number(n) || 0) + 0) < 0 ? 'var(--danger)' : 'var(--text)')
export const signedColor = (n) => (((Number(n) || 0) + 0) < 0 ? 'var(--danger)' : 'var(--ok)')

// `quantity || 1` looked harmless until the 2027 import brought in rows with a
// deliberate quantity of 0 ("on the list, not decided yet") — 0 is falsy, so
// every one of them was silently costed as a single unit. Only a missing
// quantity should default to 1; an explicit 0 means 0.
export const qtyOf = (r) => (r?.quantity == null ? 1 : Number(r.quantity) || 0)
export const lineTotal = (r) => (Number(r?.est_price) || 0) * qtyOf(r)

export const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '')

// month key + label for grouping charts
export const monthKey = (d) => (d ? new Date(d).toISOString().slice(0, 7) : '')

export const TX_TYPES = ['income', 'expense', 'transfer', 'in_kind']

export const typePill = {
  income: 'pill pill-in',
  expense: 'pill pill-out',
  transfer: 'pill pill-transfer',
  in_kind: 'pill pill-inkind',
}

export const typeColor = {
  income: '#1100ff',
  expense: '#ff9100',
  transfer: '#8a8aa0',
  in_kind: '#b06bff',
}

// Signed effect of a transaction on the "net" figure (in-kind counted separately)
export const signedNet = (t) => {
  if (t.type === 'income') return Number(t.amount)
  if (t.type === 'expense') return -Number(t.amount)
  return 0 // transfers net to zero; in_kind excluded from cash net
}
