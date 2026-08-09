import { useI18n } from '../lib/i18n'
import { money } from '../lib/format'

/**
 * The figures behind a pie, as a table.
 *
 * A donut cannot show a small slice. ₪18.37 against ₪37,000 is 0.05% — a 0.18°
 * arc, under one pixel long — so "עמלות חשבון" was drawn and simply could not
 * be seen. Making the legend louder would not have helped: the problem is the
 * geometry, not the labelling.
 *
 * So the chart keeps doing what it is good at — showing which one or two things
 * dominate — and the exact numbers live beside it where every row is readable
 * regardless of size.
 */
export default function ShareTable({ rows, colors, total }) {
  const { t } = useI18n()
  if (!rows?.length) return null
  const sum = total ?? rows.reduce((s, r) => s + Math.abs(r.value), 0)

  return (
    <table className="data share-table">
      <tbody>
        {rows.map((r, i) => (
          <tr key={r.name}>
            <td style={{ width: 14 }}>
              <span style={{
                display: 'inline-block', width: 10, height: 10, borderRadius: 2,
                background: colors[i % colors.length],
              }} />
            </td>
            <td>{r.name}</td>
            <td className="num mono">{money(r.value)}</td>
            <td className="num mono" style={{ color: 'var(--text-faint)', width: 56 }}>
              {/* A slice worth a fraction of a percent still deserves a figure
                  rather than a rounded 0%. */}
              {sum ? (() => {
                const p = (Math.abs(r.value) / sum) * 100
                return p > 0 && p < 0.1 ? '<0.1%' : `${p.toFixed(1)}%`
              })() : '—'}
            </td>
          </tr>
        ))}
        <tr style={{ borderTop: '2px solid var(--line-strong)', fontWeight: 700 }}>
          <td />
          <td>{t('total')}</td>
          <td className="num mono">{money(sum)}</td>
          <td />
        </tr>
      </tbody>
    </table>
  )
}
