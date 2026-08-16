import { useI18n } from '../lib/i18n'
import { money } from '../lib/format'

/**
 * The part of a report that is not a summary.
 *
 * Placed FIRST, before any chart. A reader who has to scroll past six charts to
 * find out that ₪6,477 was overspent will read the charts and stop — the
 * position is the emphasis, as much as the colour is.
 */
export default function ReportAlerts({ alerts }) {
  const { t } = useI18n()
  if (!alerts) return null

  if (alerts.clean) {
    // Said out loud. An absent section reads as unfinished; "nothing is over"
    // is a real answer and the one people are hoping for.
    return (
      <div className="panel panel-pad" style={{ marginBottom: 16, borderInlineStart: '3px solid var(--ok)' }}>
        <b style={{ color: 'var(--ok)' }}>{t('noAlerts')}</b>
      </div>
    )
  }

  return (
    <>
      {alerts.over.length > 0 && (
        <div className="panel panel-pad" style={{ marginBottom: 16, borderInlineStart: '4px solid var(--danger)' }}>
          <div className="section-title" style={{ marginTop: 0, color: 'var(--danger)' }}>
            {t('alertsOver')} · {money(alerts.totalOver)}
          </div>
          <p style={{ color: 'var(--text-faint)', fontSize: 12, margin: '0 0 8px' }}>{t('alertsOverHint')}</p>
          <div className="table-wrap">
            <table className="data">
              <tbody>
                {alerts.over.map((o) => (
                  <tr key={o.id}>
                    <td>{o.label}</td>
                    <td className="num mono">{money(o.amount)}</td>
                    <td className="num mono">{money(o.spent)}</td>
                    <td className="num mono" style={{ color: 'var(--danger)', fontWeight: 700 }}>
                      +{money(o.by)}
                    </td>
                    <td className="num mono" style={{ color: 'var(--text-faint)' }}>
                      {o.pct == null ? '—' : `${Math.round(o.pct)}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {alerts.unused.length > 0 && (
        <div className="panel panel-pad" style={{ marginBottom: 16, borderInlineStart: '4px solid var(--orange)' }}>
          <div className="section-title" style={{ marginTop: 0 }}>
            {t('alertsUnused')} · {money(alerts.totalUnused)}
          </div>
          <p style={{ color: 'var(--text-faint)', fontSize: 12, margin: '0 0 8px' }}>{t('alertsUnusedHint')}</p>
          <div className="table-wrap">
            <table className="data">
              <tbody>
                {alerts.unused.map((u) => (
                  <tr key={u.id}>
                    <td>{u.label}</td>
                    <td className="num mono">{money(u.amount)}</td>
                    <td className="num mono">{money(u.spent)}</td>
                    <td className="num mono" style={{ fontWeight: 700 }}>{money(u.left)}</td>
                    <td className="num mono" style={{ color: 'var(--text-faint)' }}>{Math.round(u.pct)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  )
}
