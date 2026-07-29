import { useI18n } from '../lib/i18n'
import { money, fmtDate } from '../lib/format'

// Pending proposals, shown above the ledger for a mentor.
//
// Kept visually separate from the ledger on purpose: these amounts are NOT in
// any balance, budget or report, and a row that sits among real transactions
// looking identical to them invites exactly that misreading.
export default function ApprovalQueue({ rows, onDecide, busyId }) {
  const { t } = useI18n()
  if (!rows.length) return null

  return (
    <div className="panel panel-pad" style={{
      borderColor: 'var(--orange)', borderInlineStartWidth: 4,
      borderInlineStartStyle: 'solid', background: 'rgba(255,145,0,.06)', marginBottom: 14,
    }}>
      <div className="section-title" style={{ marginTop: 0 }}>
        {t('approvalQueue')} ({rows.length})
      </div>
      <p style={{ color: 'var(--text-dim)', fontSize: 13, marginTop: 0 }}>{t('pendingHint')}</p>

      {rows.map((r) => (
        <div key={r.id} style={{
          display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap',
          padding: '8px 0', borderTop: '1px solid var(--line)',
        }}>
          <span className="mono" style={{ whiteSpace: 'nowrap' }}>{fmtDate(r.date)}</span>
          <span className="mono" style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{money(r.amount)}</span>
          <span style={{ color: 'var(--text-dim)', flex: '1 1 8rem' }}>
            {r.description || r.vendor || '—'}
          </span>
          {r.proposer_name && (
            <span style={{ color: 'var(--text-faint)', fontSize: 12, whiteSpace: 'nowrap' }}>
              {t('proposedBy')}: {r.proposer_name}
            </span>
          )}
          <span style={{ display: 'flex', gap: 6 }}>
            <button className="btn btn-primary btn-sm" disabled={busyId === r.id}
              onClick={() => onDecide(r, true)}>{t('approve')}</button>
            <button className="btn btn-ghost btn-sm btn-danger" disabled={busyId === r.id}
              onClick={() => onDecide(r, false)}>{t('reject')}</button>
          </span>
        </div>
      ))}
    </div>
  )
}
