import { useI18n } from '../lib/i18n'
import { money } from '../lib/format'

/**
 * Where the season started, stands, and is heading.
 *
 * The four figures belong together: an opening balance on its own says nothing,
 * and a projection without the opening beside it gives no sense of direction.
 * Read left to right it is a sentence — started here, here now, this much is
 * promised, so this is where it lands.
 *
 * In a simulation the projection also carries the planned income and spend,
 * which is the case that makes it worth building: a plan adding sponsorship
 * changes the year-end figure, and nothing else on the page showed that.
 */
export default function YearOutlook({ outlook, isSimulation = false }) {
  const { t } = useI18n()
  if (!outlook) return null

  const negative = outlook.projected < 0

  return (
    <div className="panel panel-pad year-outlook">
      <div className="section-title" style={{ marginTop: 0 }}>{t('yearOutlook')}</div>

      <div className="outlook-row">
        <div>
          <span>{t('openingAtStart')}</span>
          <b className="mono">{money(outlook.opening)}</b>
        </div>
        <div className="outlook-arrow" aria-hidden="true">→</div>
        <div>
          <span>{t('balanceToday')}</span>
          <b className="mono">{money(outlook.balanceNow)}</b>
        </div>
        <div className="outlook-arrow" aria-hidden="true">→</div>
        <div>
          {/* Stated as a subtraction, not folded silently into the result — the
              committed figure is the one people query, and hiding it would make
              the projection look arbitrary. */}
          <span>{t('stillCommitted')}</span>
          <b className="mono">−{money(outlook.committed)}</b>
        </div>
        <div className="outlook-arrow" aria-hidden="true">=</div>
        <div className="outlook-final">
          <span>{t('projectedYearEnd')}</span>
          <b className="mono" style={{ color: negative ? 'var(--danger)' : 'var(--ok)' }}>
            {money(outlook.projected)}
          </b>
        </div>
      </div>

      <p className="outlook-hint">
        {t('yearOutlookHint')}
        {isSimulation && ` ${t('yearOutlookSimHint')}`}
      </p>
    </div>
  )
}
