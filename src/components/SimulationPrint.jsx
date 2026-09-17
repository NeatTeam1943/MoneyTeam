import { useI18n } from '../lib/i18n'
import { money } from '../lib/format'

/**
 * The printed version of a simulation.
 *
 * A separate document, not the working screen with its controls hidden. Those
 * are different things: the screen is for BUILDING a plan — checkboxes, filters,
 * a selection table — and printing it produced exactly that, a page of tick
 * boxes with no totals. What a reader needs is the CONCLUSION: what it costs,
 * what it leaves, and what it breaks.
 *
 * Ordered by what someone asks first. The cost, then the accounts it comes out
 * of, then the warnings, then the itemised list last — because by the time you
 * want line detail you have already decided the plan is worth reading.
 */
export default function SimulationPrint({
  seasonName, selected, extras, incomes,
  plannedSpend, plannedIncome, totalAfter, outlook,
  projectedAccounts, goingNegative, newlyOver, goalOutlook, costOf,
}) {
  const { t } = useI18n()
  const today = new Date().toLocaleDateString('he-IL')
  const breaks = (goingNegative?.length || 0) + (newlyOver?.length || 0)

  return (
    <div className="sim-print">
      <header className="sim-print-head">
        <div className="sim-print-team">NEAT TEAM 1943</div>
        <h1>{t('simulation')}</h1>
        <div className="sim-print-meta">{seasonName || ''} · {today}</div>
      </header>

      {/* The answer, before anything else. A reader who has to add up a column
          to find out what this costs will not. */}
      <section className="sim-print-figures">
        <div>
          <span>{t('plannedSpend')}</span>
          <b>{money(plannedSpend)}</b>
        </div>
        {plannedIncome > 0 && (
          <div>
            <span>{t('plannedIncome')}</span>
            <b>{money(plannedIncome)}</b>
          </div>
        )}
        <div className="sim-print-total">
          <span>{t('projectedTotal')}</span>
          <b>{money(totalAfter)}</b>
        </div>
        {/* The year-end figure belongs on the shared page too: "what is left
            today" and "where the season lands" are different answers, and the
            second is the one a reader takes a decision on. */}
        {outlook && (
          <div className="sim-print-total">
            <span>{t('projectedYearEnd')}</span>
            <b>{money(outlook.projected)}</b>
          </div>
        )}
      </section>

      {/* Warnings second. If a plan sends an account negative, that is the
          thing to say before the itemisation, not after it. */}
      {breaks > 0 && (
        <section className="sim-print-warn">
          <h2>{t('whatBreaks')}</h2>
          <ul>
            {goingNegative?.map((a) => (
              <li key={a.id}>{t('accountGoesNegative').replace('{a}', a.name).replace('{v}', money(a.after))}</li>
            ))}
            {newlyOver?.map((b) => (
              <li key={b.id}>{t('budgetGoesOver').replace('{b}', b.label).replace('{v}', money(b.after - b.amount))}</li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2>{t('projectedBalances')}</h2>
        <table>
          <thead><tr>
            <th>{t('account')}</th>
            <th className="num">{t('current')}</th>
            <th className="num">{t('change')}</th>
            <th className="num">{t('projected')}</th>
          </tr></thead>
          <tbody>
            {projectedAccounts?.map((a) => (
              <tr key={a.id}>
                <td>{a.name}</td>
                <td className="num">{money(a.before)}</td>
                <td className="num">{a.delta ? (a.delta > 0 ? '+' : '') + money(a.delta) : '—'}</td>
                <td className="num"><b>{money(a.after)}</b></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {goalOutlook?.rows?.length > 0 && (
        <section>
          <h2>{t('goalsAfterPlan')}</h2>
          <table>
            <thead><tr>
              <th>{t('name')}</th>
              <th className="num">{t('target')}</th>
              <th className="num">{t('afterPlan')}</th>
              <th className="num">{t('shortBy')}</th>
            </tr></thead>
            <tbody>
              {goalOutlook.rows.map((g) => (
                <tr key={g.id}>
                  <td>{g.name}</td>
                  <td className="num">{money(g.target)}</td>
                  <td className="num">{money(g.reservedAfter)}</td>
                  <td className="num">{g.metAfter ? '✓' : money(g.shortAfter)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* Last. No checkboxes, no status chips, no links — a printed page cannot
          be clicked, and every one of those was noise in the first attempt. */}
      {selected?.length > 0 && (
        <section>
          <h2>{t('itemsPicked')} ({selected.length})</h2>
          <table>
            <thead><tr>
              <th>{t('name')}</th>
              <th>{t('category')}</th>
              <th className="num">{t('unitCount')}</th>
              <th className="num">{t('total')}</th>
            </tr></thead>
            <tbody>
              {selected.map((r) => (
                <tr key={r.id}>
                  <td>{r.name}</td>
                  <td>{r.categoryName || '—'}</td>
                  <td className="num">{r.quantity ?? 1}</td>
                  <td className="num">{money(costOf(r))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {extras?.length > 0 && (
        <section>
          <h2>{t('adHocRows')}</h2>
          <table>
            <tbody>
              {extras.map((e) => (
                <tr key={e.id}>
                  <td>{e.label || '—'}</td>
                  <td className="num">{money(e.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {incomes?.length > 0 && (
        <section>
          <h2>{t('plannedIncome')}</h2>
          <table>
            <tbody>
              {incomes.map((r, i) => (
                <tr key={i}>
                  <td>{r.label || '—'}</td>
                  <td className="num">{money(r.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <footer className="sim-print-foot">{t('simPrintFooter')}</footer>
    </div>
  )
}
