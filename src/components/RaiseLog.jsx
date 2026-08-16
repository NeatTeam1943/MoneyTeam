import { useI18n } from '../lib/i18n'
import { money, fmtDate } from '../lib/format'

/**
 * Every decided raise, kept.
 *
 * Without this a ceiling grows and nobody can say who asked, for what, or when
 * — and a budget that quietly matches its spending looks like good planning
 * rather than a figure that was moved to fit.
 *
 * Rejected requests stay too: "we asked and were told no" is part of the record
 * and stops the same request being made twice.
 */
export default function RaiseLog({ rows, onDecide, isMentor }) {
  const { t } = useI18n()
  if (!rows?.length) return null

  return (
    <div className="panel panel-pad" style={{ marginTop: 16 }}>
      <div className="section-title" style={{ marginTop: 0 }}>{t('raiseLog')}</div>
      <div className="table-wrap">
        <table className="data">
          <thead><tr>
            <th>{t('date')}</th>
            <th className="num">{t('from')}</th>
            <th className="num">{t('to')}</th>
            <th>{t('raiseReason')}</th>
            <th>{t('status')}</th>
            {isMentor && <th>{t('actions')}</th>}
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="mono">{fmtDate(r.requested_at)}</td>
                <td className="num mono">{money(r.amount_before)}</td>
                <td className="num mono">{money(r.amount_after)}</td>
                <td style={{ overflowWrap: 'anywhere' }}>
                  {r.reason}
                  {/* Recorded at request time: it explains the request to
                      whoever reads this later. */}
                  {r.was_over && (
                    <div style={{ fontSize: 12, color: 'var(--text-faint)' }}>{t('raiseWasOver')}</div>
                  )}
                </td>
                <td>
                  {r.status === 'pending' ? t('pending')
                    : r.status === 'approved' ? t('raiseApprovedBy') : t('raiseRejected')}
                </td>
                {isMentor && (
                  <td>
                    {r.status === 'pending' && (
                      <span style={{ display: 'inline-flex', gap: 4 }}>
                        <button className="btn btn-sm btn-primary" onClick={() => onDecide(r, true)}>{t('approve')}</button>
                        <button className="btn btn-sm" onClick={() => onDecide(r, false)}>{t('reject')}</button>
                      </span>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
