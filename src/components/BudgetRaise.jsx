import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'
import { money } from '../lib/format'
import { raiseContext, validateRaise } from '../domain/budgetRaise'
import Modal from './Modal'

/**
 * Ask for a budget to be raised.
 *
 * Being over budget does NOT block the request — the two are independent. But
 * the form says so when it applies, because "request a raise" must not quietly
 * become the way an overspend is made to disappear: the money went out either
 * way, and the reports will keep saying so.
 *
 * A reason is required. A ceiling that moved without one is a number nobody can
 * explain in six months, which is exactly what the log exists to prevent.
 */
export default function BudgetRaise({ budget, spent, isMentor, onClose, onDone }) {
  const { t } = useI18n()
  const ctx = raiseContext(budget, spent)
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const submit = async () => {
    const v = validateRaise(amount, ctx.amount)
    if (!v.ok) { setErr(t(v.key)); return }
    if (!reason.trim()) { setErr(t('raiseReasonHint')); return }
    setBusy(true); setErr('')
    const { error } = await supabase.rpc('request_budget_raise', {
      p_budget_id: budget.id,
      p_new_amount: Number(amount),
      p_reason: reason.trim(),
    })
    setBusy(false)
    if (error) { setErr(error.message); return }
    onDone(isMentor ? null : t('raiseRequested'))
  }

  return (
    <Modal title={t('requestRaise')} onClose={onClose} footer={
      <>
        <button className="btn btn-ghost" onClick={onClose}>{t('cancel')}</button>
        <button className="btn btn-primary" onClick={submit} disabled={busy}>{t('save')}</button>
      </>
    }>
      {err && <div className="empty" style={{ color: 'var(--danger)' }}>{err}</div>}

      <div className="field">
        <label>{t('budget')}</label>
        <div className="mono">{money(ctx.amount)} · {t('spent')} {money(ctx.spent)}</div>
      </div>

      {/* Stated, not blocking. A raise and an overspend are different decisions
          and the screen has to keep them apart. */}
      {ctx.isOver && (
        <p style={{
          fontSize: 13, color: 'var(--text-dim)', background: 'var(--bg-1)',
          padding: '8px 10px', borderRadius: 6,
          borderInlineStart: '3px solid var(--orange)',
        }}>
          {t('raiseNotForOverspend').replace('{v}', money(ctx.over))}
        </p>
      )}

      <div className="field">
        <label>{t('raiseTo')} (₪) *</label>
        <input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
        {/* Says which way it goes, as soon as there is a number. A request that
            lowers a budget is legitimate — while budgets are locked it is the
            only route to correcting an over-estimate — but it should never be
            submitted by accident. */}
        {(() => {
          if (amount === '') return null
          const v = validateRaise(amount, ctx.amount)
          if (!v.ok) return null
          return (
            <p style={{
              fontSize: 13, margin: '6px 0 0',
              color: v.direction === 'decrease' ? 'var(--orange)' : 'var(--text-dim)',
            }}>
              {t(v.direction === 'decrease' ? 'raiseIsDecrease' : 'raiseIsIncrease')
                .replace('{v}', money(Math.abs(v.delta)))}
            </p>
          )
        })()}
      </div>

      <div className="field">
        <label>{t('raiseReason')} *</label>
        <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
        <p style={{ fontSize: 12, color: 'var(--text-faint)', margin: '4px 0 0' }}>{t('raiseReasonHint')}</p>
      </div>
    </Modal>
  )
}
