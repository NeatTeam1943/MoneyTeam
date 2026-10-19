import { useI18n } from '../lib/i18n'
import { money } from '../lib/format'
import { lineAmount } from '../domain/money'

/**
 * The breakdown of one income — a parent's registration, typically.
 *
 * Deliberately NOT the expense line editor reused. An expense line answers
 * "which budget does this come out of"; an income line answers "what was this
 * payment made up of". They share only the word "line", and merging them would
 * put a budget picker on a registration fee and a quantity on a hardware
 * purchase.
 *
 * ── Negative lines ─────────────────────────────────────────────────────────
 * A discount is a line with a negative amount, not a separate concept. Two
 * children in the team means one fee line and one discount line, and the
 * receipt then SHOWS the discount instead of quietly presenting a reduced fee
 * that nobody can reconcile against the price list. The only rule is that the
 * net must come to more than zero — an "income" that nets out at or below zero
 * is not an income, and letting one through would put a negative row in the
 * account balance.
 */
export default function IncomeLines({ lines, accounts, onChange, methods }) {
  const { t } = useI18n()

  const set = (i, k, v) => onChange(lines.map((l, idx) => (idx === i ? { ...l, [k]: v } : l)))
  const add = () => onChange([...lines, emptyIncomeLine(lines[0]?.account_id)])
  const remove = (i) => onChange(lines.length > 1 ? lines.filter((_, idx) => idx !== i) : lines)

  const total = lines.reduce((s, l) => s + lineAmount(l), 0)

  return (
    <div className="field">
      <label>{t('incomeLines')}</label>
      {lines.map((l, i) => {
        const amount = lineAmount(l)
        return (
          <div key={i} className="income-line">
            <input className="il-desc" placeholder={t('description')} value={l.description || ''}
              onChange={(e) => set(i, 'description', e.target.value)} />

            {/* Price PER ITEM. The row total is derived, never typed, so the
                receipt's multiplication cannot disagree with its own total. */}
            <input className="il-price" type="number" step="0.01" placeholder={t('unitPrice')}
              value={l.unit_price ?? ''} onChange={(e) => set(i, 'unit_price', e.target.value)} />

            <input className="il-qty" type="number" step="1" min="0" placeholder={t('quantity')}
              value={l.quantity ?? 1} onChange={(e) => set(i, 'quantity', e.target.value)} />

            {/* Per line, because one registration can genuinely arrive as part
                cash and part transfer, and the receipt has a column for it. */}
            <input className="il-method" list="payment-methods" placeholder={t('paymentMethod')}
              value={l.payment_method || ''} onChange={(e) => set(i, 'payment_method', e.target.value)} />

            {/* Per line, because a split registration lands in two accounts
                while remaining one payment and one receipt. */}
            <select className="il-account" value={l.account_id || ''}
              onChange={(e) => set(i, 'account_id', e.target.value)}>
              <option value="">{t('account')}…</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>

            <span className={'il-total mono' + (amount < 0 ? ' il-discount' : '')}>{money(amount)}</span>

            <button type="button" className="btn btn-ghost btn-sm btn-danger"
              onClick={() => remove(i)} title={t('delete')}>✕</button>
          </div>
        )
      })}

      <datalist id="payment-methods">
        {(methods || []).map((m) => <option key={m} value={m} />)}
      </datalist>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6, gap: 10 }}>
        <button type="button" className="btn btn-sm" onClick={add}>+ {t('addIncomeLine')}</button>
        <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>{t('discountHint')}</span>
        <span className="mono" style={{ fontWeight: 700 }}>{t('total')}: {money(total)}</span>
      </div>
    </div>
  )
}

/** A blank line. The account carries over from the line above, because a
 *  split payment is the exception and retyping the same account on every row
 *  is the common case. */
export const emptyIncomeLine = (accountId = '') => ({
  description: '', unit_price: '', quantity: 1, payment_method: '', account_id: accountId,
})

/** Shared by the form and anything else that needs the same answer. */
export const incomeLinesTotal = (lines) => (lines || []).reduce((s, l) => s + lineAmount(l), 0)
