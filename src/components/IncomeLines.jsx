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
 * ── Why each line is a block and not a row ─────────────────────────────────
 * The first version laid the six fields out in one row and let a media query
 * stack them on a phone. That was the wrong measurement: this control lives
 * inside a dialog that is at most 520px wide, so on a 27" screen the row was
 * still six fields in 520px — a payment-method box too narrow to read back
 * what had been chosen. The grid is sized by the SPACE IT HAS rather than by
 * the width of the window, and every field carries a label, because a
 * placeholder disappears the moment there is a value and then nothing says
 * which box is the price and which is the quantity.
 *
 * ── Negative lines ─────────────────────────────────────────────────────────
 * A discount is a line with a negative amount, not a separate concept. Two
 * children in the team means one fee line and one discount line, and the
 * receipt then SHOWS the discount instead of quietly presenting a reduced fee
 * that nobody can reconcile against the price list. The only rule is that the
 * net must come to more than zero.
 */
export default function IncomeLines({ lines, accounts, onChange, methods }) {
  const { t } = useI18n()

  const set = (i, k, v) => onChange(lines.map((l, idx) => (idx === i ? { ...l, [k]: v } : l)))
  const add = () => onChange([...lines, emptyIncomeLine(lines[lines.length - 1]?.account_id)])
  const remove = (i) => onChange(lines.length > 1 ? lines.filter((_, idx) => idx !== i) : lines)

  const total = lines.reduce((s, l) => s + lineAmount(l), 0)

  return (
    <div className="field">
      <label>{t('incomeLines')}</label>

      {lines.map((l, i) => {
        const amount = lineAmount(l)
        return (
          <div key={i} className="income-line">
            <div className="il-field">
              <span>{t('description')}</span>
              <input value={l.description || ''}
                onChange={(e) => set(i, 'description', e.target.value)} />
            </div>

            <div className="il-mid">
            <div className="il-field">
              {/* Per ITEM. The row total below is derived, never typed, so the
                  receipt's multiplication cannot disagree with its own total. */}
              <span>{t('unitPrice')}</span>
              <input type="number" step="0.01" inputMode="decimal" value={l.unit_price ?? ''}
                onChange={(e) => set(i, 'unit_price', e.target.value)} />
            </div>

            <div className="il-field">
              <span>{t('quantity')}</span>
              <input type="number" step="1" min="0" inputMode="numeric" value={l.quantity ?? 1}
                onChange={(e) => set(i, 'quantity', e.target.value)} />
            </div>

            <div className="il-field">
              {/* A list, not a closed set — the next parent will pay by
                  something nobody thought of, so it stays typeable. */}
              <span>{t('paymentMethod')}</span>
              <input list="payment-methods" value={l.payment_method || ''}
                onChange={(e) => set(i, 'payment_method', e.target.value)} />
            </div>

            <div className="il-field il-account">
              {/* Per line, because a split registration lands in two accounts
                  while remaining one payment and one receipt. Wider than its
                  neighbours because an account name is a name, not a number —
                  but not a row of its own, which was mostly empty. */}
              <span>{t('account')}</span>
              <select value={l.account_id || ''}
                onChange={(e) => set(i, 'account_id', e.target.value)}>
                <option value="">—</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            </div>

            <div className="il-foot">
              <span className={'mono il-total' + (amount < 0 ? ' il-discount' : '')}>
                {t('lineTotal')}: {money(amount)}
              </span>
              {lines.length > 1 && (
                <button type="button" className="btn btn-ghost btn-sm btn-danger"
                  onClick={() => remove(i)}>{t('delete')}</button>
              )}
            </div>
          </div>
        )
      })}

      <datalist id="payment-methods">
        {(methods || []).map((m) => <option key={m} value={m} />)}
      </datalist>

      <div className="il-bar">
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
  description: '', unit_price: '', quantity: 1, payment_method: '', account_id: accountId || '',
})

/** Shared by the form and anything else that needs the same answer. */
export const incomeLinesTotal = (lines) => (lines || []).reduce((s, l) => s + lineAmount(l), 0)
