import { useEffect, useMemo, useState } from 'react'
import { supabase, withTimeout } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useSeason } from '../context/SeasonContext'
import { useI18n } from '../lib/i18n'
import { useToast } from '../lib/toast'
import { useLookups } from '../lib/useLookups'
import { useTeamScope } from '../context/TeamScopeContext'
import { TeamScopeBadge } from '../components/TeamScope'
import { money, amountColor, signedColor, lineTotal, qtyOf } from '../lib/format'
import { projectAccounts, projectBudgets, newlyNegative, newlyOver as newlyOverOf } from '../domain/simulation'
import { OPEN_STATUSES } from '../domain/constants'

// What-if planner. It answers the question a mentor actually asks in front of
// a wish list: "if I approve this lot, what breaks?"
//
// Nothing here writes to the database — it takes today's real balances and
// budget burn, layers the selected wish-list items on top as if they had been
// bought, adds any income you say you expect, and shows where that lands.
// Deliberately simple arithmetic, not a forecast: no trend fitting, no
// guessing at future spend you have not listed.
export default function Simulation() {
  const { t } = useI18n()
  const { session } = useAuth()
  const uid = session?.user?.id
  const { activeId } = useSeason()
  const toast = useToast()
  const lk = useLookups()
  const ts = useTeamScope()

  const [items, setItems] = useState([])
  const [budgets, setBudgets] = useState([])
  const [lines, setLines] = useState([])
  const [balances, setBalances] = useState([])
  const [loading, setLoading] = useState(true)

  const [picked, setPicked] = useState(() => new Set())
  // Default account for anything newly picked. Individual rows can override it,
  // because one basket is often paid from more than one place — part from the
  // bank, part from store credit.
  const [fundFrom, setFundFrom] = useState('')
  const [fundBy, setFundBy] = useState({})     // { [itemId]: accountId }
  const [incomes, setIncomes] = useState([])   // [{ label, amount, account_id }]
  // Things that are not on the shopping list yet. The point of the page is to
  // decide whether they SHOULD be, so they have to be costable before they
  // exist as records.
  const [extras, setExtras] = useState([])     // [{ id, label, amount, category_id, team_scope, account_id }]

  async function load() {
    if (!activeId) { setLoading(false); return }
    try {
      const [it, bg, tl, bal] = await withTimeout(Promise.all([
        supabase.from('shopping_items').select('*').eq('season_id', activeId),
        supabase.from('budgets').select('*').eq('season_id', activeId),
        supabase.from('ledger_lines_full').select('amount,budget_id,team_scope,category_id,season_id,tx_team_scope').eq('season_id', activeId),
        supabase.from('account_balances').select('*'),
      ]))
      if (!it.error) setItems(it.data || [])
      if (!bg.error) setBudgets(bg.data || [])
      if (!tl.error) setLines(tl.data || [])
      if (!bal.error) setBalances(bal.data || [])
    } catch (e) {
      if (e.message === 'timeout') toast.error(t('loadTimedOut'))
    } finally { setLoading(false) }
  }
  useEffect(() => { if (uid) load(); else setLoading(false) }, [activeId, uid])   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (!fundFrom && lk.accountsActive.length) setFundFrom(lk.accountsActive[0].id) }, [lk.accountsActive, fundFrom])

  // Only things still genuinely outstanding can be "planned" — anything already
  // ordered or received is real spend and is already in the balances.
  const open = useMemo(() => items.filter(
    (r) => ts.matches(r.team_scope) && OPEN_STATUSES.includes(r.status)
  ), [items, ts])

  const cost = lineTotal
  const priced = useMemo(() => open.filter((r) => cost(r) > 0), [open])
  const unpriced = useMemo(() => open.filter((r) => cost(r) <= 0), [open])

  const selected = useMemo(() => open.filter((r) => picked.has(r.id)), [open, picked])
  const accountFor = (id) => fundBy[id] || fundFrom
  const scopedExtras = useMemo(() => extras.filter((e) => ts.matches(e.team_scope || 'both')), [extras, ts])
  const extrasSpend = useMemo(() => scopedExtras.reduce((s, e) => s + (Number(e.amount) || 0), 0), [scopedExtras])
  const plannedSpend = useMemo(
    () => selected.reduce((s, r) => s + cost(r), 0) + extrasSpend, [selected, extrasSpend])
  const plannedIncome = useMemo(() => incomes.reduce((s, r) => s + (Number(r.amount) || 0), 0), [incomes])

  const toggle = (id) => setPicked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const pickAll = () => setPicked(new Set(priced.map((r) => r.id)))
  const pickNone = () => setPicked(new Set())
  const pickByLevel = (levelId) => setPicked(new Set(priced.filter((r) => r.priority_level_id === levelId).map((r) => r.id)))

  // ---- projected account balances -----------------------------------------
  const projectedAccounts = useMemo(() => projectAccounts({
    balances, incomes, picked: selected, extras: scopedExtras,
    accountFor, defaultAccount: fundFrom,
  }), [balances, incomes, selected, scopedExtras, fundBy, fundFrom])   // eslint-disable-line react-hooks/exhaustive-deps

  const totalAfter = projectedAccounts.reduce((s, a) => s + a.after, 0)
  const goingNegative = newlyNegative(projectedAccounts)

  // ---- projected budget burn ----------------------------------------------
  const budgetCat = useMemo(() => Object.fromEntries(budgets.map((b) => [b.id, b.category_id])), [budgets])
  const budgetForCategory = (categoryId) => (budgets.find((b) => b.category_id === categoryId) || {}).id || null

  const projectedBudgets = useMemo(() => projectBudgets({
    budgets: budgets.filter((b) => ts.matches(b.team_scope)),
    lines,
    picked: selected,
    extras: scopedExtras,
    budgetCategory: budgetCat,
    inScopeFor: (b) => {
      const set = b.category_id ? lk.descendantsOf(b.category_id) : null
      return (cid) => (b.category_id ? (cid && set.has(cid)) : true)
    },
    labelFor: (b) => (b.category_id ? (lk.categoryName[b.category_id] || t('uncategorized')) : t('overall'))
      + ((b.team_scope && b.team_scope !== 'both') ? ` · ${b.team_scope.toUpperCase()}` : ''),
    // Same ownership model as the Budgets page — without it each program's pot
    // reports the whole category's spend.
    parentOf: lk.parentOf,
  }).sort((a, b) => (a.label === t('overall') ? -1 : 0) - (b.label === t('overall') ? -1 : 0) || b.after - a.after),
    [budgets, lines, selected, scopedExtras, budgetCat, lk, t, ts])

  const newlyOver = newlyOverOf(projectedBudgets)

  // Items whose category has no budget at all — easy to miss, and they quietly
  // consume cash without showing up against any line.
  const unbudgeted = useMemo(
    () => [...selected, ...scopedExtras].filter((r) => !budgetForCategory(r.category_id)),
    [selected, scopedExtras, budgets])   // eslint-disable-line react-hooks/exhaustive-deps

  const addExtra = () => setExtras([...extras, {
    id: `x${Date.now()}`, label: '', amount: '', category_id: '', team_scope: 'both', account_id: fundFrom,
  }])
  const setExtra = (i, k, v) => setExtras(extras.map((r, idx) => idx === i ? { ...r, [k]: v } : r))
  const removeExtra = (i) => setExtras(extras.filter((_, idx) => idx !== i))

  const addIncome = () => setIncomes([...incomes, { label: '', amount: '', account_id: fundFrom }])
  const setIncome = (i, k, v) => setIncomes(incomes.map((r, idx) => idx === i ? { ...r, [k]: v } : r))
  const removeIncome = (i) => setIncomes(incomes.filter((_, idx) => idx !== i))

  if (loading) return <div className="panel empty">{t('loading')}</div>

  return (
    <div>
      <p style={{ color: 'var(--text-faint)', fontSize: 13, marginTop: 0 }}>{t('simulationHint')}</p>

      <div className="stats">
        <Stat k={t('plannedSpend')} v={money(plannedSpend)} c="var(--out)" />
        <Stat k={t('plannedIncome')} v={money(plannedIncome)} c="var(--in)" />
        <Stat k={t('projectedTotal')} v={money(totalAfter)} c={amountColor(totalAfter)} />
        <Stat k={t('itemsPicked')} v={`${selected.length}/${priced.length}`} c="var(--text)" />
      </div>

      {(goingNegative.length > 0 || newlyOver.length > 0 || unbudgeted.length > 0) && (
        <div className="panel panel-pad" style={{ borderColor: 'var(--danger)', marginTop: 14 }}>
          <div className="section-title" style={{ marginTop: 0, color: 'var(--danger)' }}>{t('whatBreaks')}</div>
          <ul style={{ margin: 0, paddingInlineStart: 18, fontSize: 13, lineHeight: 1.9 }}>
            {goingNegative.map((a) => <li key={a.id}>{t('accountGoesNegative').replace('{a}', a.name).replace('{v}', money(a.after))}</li>)}
            {newlyOver.map((b) => <li key={b.id}>{t('budgetGoesOver').replace('{b}', b.label).replace('{v}', money(b.after - b.amount))}</li>)}
            {unbudgeted.length > 0 && <li>{t('itemsWithNoBudget').replace('{n}', unbudgeted.length)}</li>}
          </ul>
        </div>
      )}

      <div className="section-title">{t('projectedBalances')}</div>
      <div className="panel table-wrap">
        <table className="data">
          <thead><tr>
            <th>{t('account')}</th><th>{t('current')}</th><th>{t('change')}</th><th>{t('projected')}</th>
          </tr></thead>
          <tbody>
            {projectedAccounts.map((a) => (
              <tr key={a.id}>
                <td>{a.name}</td>
                <td className="num mono" style={{ color: amountColor(a.before) }}>{money(a.before)}</td>
                <td className="num mono" style={{ color: a.delta ? signedColor(a.delta) : 'var(--text-faint)' }}>
                  {a.delta ? (a.delta > 0 ? '+' : '') + money(a.delta) : '—'}
                </td>
                <td className="num mono" style={{ color: amountColor(a.after), fontWeight: 700 }}>{money(a.after)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="section-title">{t('expectedIncome')}</div>
      <div className="panel panel-pad">
        {incomes.map((r, i) => (
          <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
            <input placeholder={t('description')} value={r.label} onChange={(e) => setIncome(i, 'label', e.target.value)} style={{ flex: '2 1 160px' }} />
            <input type="number" step="0.01" min="0" placeholder="₪" value={r.amount} onChange={(e) => setIncome(i, 'amount', e.target.value)} style={{ flex: '1 1 120px' }} />
            <select value={r.account_id} onChange={(e) => setIncome(i, 'account_id', e.target.value)} style={{ flex: '1 1 150px' }}>
              {lk.accountsActive.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <button className="btn btn-ghost btn-sm btn-danger" onClick={() => removeIncome(i)}>✕</button>
          </div>
        ))}
        <button className="btn btn-sm" onClick={addIncome}>+ {t('addIncomeRow')}</button>
      </div>

      <div className="section-title">{t('projectedBudgets')}</div>
      <div className="panel table-wrap">
        <table className="data">
          <thead><tr>
            <th>{t('budget')}</th><th>{t('spent')}</th><th>{t('planned')}</th><th>{t('projected')}</th><th>{t('remaining')}</th><th>%</th>
          </tr></thead>
          <tbody>
            {projectedBudgets.map((b) => (
              <tr key={b.id} style={b.nowOver ? { background: 'rgba(224,56,76,.06)' } : undefined}>
                <td>{b.label}{b.nowOver && !b.wasOver && <span className="pill" style={{ marginInlineStart: 6, background: 'rgba(224,56,76,.14)', color: 'var(--danger)' }}>{t('newlyOver')}</span>}</td>
                <td className="num mono">{money(b.spent)}</td>
                <td className="num mono" style={{ color: b.planned ? 'var(--out)' : 'var(--text-faint)' }}>{b.planned ? money(b.planned) : '—'}</td>
                <td className="num mono" style={{ fontWeight: 700 }}>{money(b.after)}</td>
                <td className="num mono" style={{ color: amountColor(b.remaining) }}>{money(b.remaining)}</td>
                <td className="num mono" style={{ color: b.pct > 100 ? 'var(--danger)' : 'var(--text-faint)' }}>{b.amount > 0 ? Math.round(b.pct) + '%' : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!projectedBudgets.length && <div className="empty">{t('noBudgetsYet')}</div>}
      </div>

      <div className="section-title">{t('adHocItems')}</div>
      <div className="panel panel-pad">
        <p style={{ color: 'var(--text-faint)', fontSize: 13, marginTop: 0 }}>{t('adHocHint')}</p>
        {extras.map((r, i) => (
          <div key={r.id} style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input placeholder={t('description')} value={r.label}
              onChange={(e) => setExtra(i, 'label', e.target.value)} style={{ flex: '2 1 12rem' }} />
            <input type="number" step="0.01" min="0" placeholder="₪" value={r.amount}
              onChange={(e) => setExtra(i, 'amount', e.target.value)} style={{ flex: '1 1 7rem' }} />
            <select value={r.category_id} onChange={(e) => setExtra(i, 'category_id', e.target.value)} style={{ flex: '1 1 10rem' }}>
              <option value="">{t('uncategorized')}</option>
              {lk.categoryTree.map((c) => <option key={c.id} value={c.id}>{c.path || c.name}</option>)}
            </select>
            <select value={r.team_scope} onChange={(e) => setExtra(i, 'team_scope', e.target.value)} style={{ flex: '0 1 7rem' }}>
              <option value="both">{t('scope_both')}</option>
              <option value="frc">{t('scope_frc')}</option>
              <option value="ftc">{t('scope_ftc')}</option>
            </select>
            <select value={r.account_id || fundFrom} onChange={(e) => setExtra(i, 'account_id', e.target.value)} style={{ flex: '1 1 9rem' }}>
              {lk.accountsActive.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <button className="btn btn-ghost btn-sm btn-danger" onClick={() => removeExtra(i)}>✕</button>
          </div>
        ))}
        <button className="btn btn-sm" onClick={addExtra}>+ {t('addAdHoc')}</button>
      </div>

      <div className="section-title">{t('pickItems')}</div>
      <div className="toolbar">
        <select value={fundFrom} onChange={(e) => { setFundFrom(e.target.value); setFundBy({}) }}
          title={t('defaultFundHint')}>
          {lk.accountsActive.map((a) => <option key={a.id} value={a.id}>{t('defaultFund')}: {a.name}</option>)}
        </select>
        <button className="btn btn-sm" onClick={pickAll}>{t('selectAll')}</button>
        <button className="btn btn-sm" onClick={pickNone}>{t('selectNone')}</button>
        {lk.levels.map((l) => (
          <button key={l.id} className="btn btn-sm" onClick={() => pickByLevel(l.id)}>{l.name}</button>
        ))}
      </div>

      <div className="panel table-wrap">
        <table className="data">
          <thead><tr>
            <th></th><th>{t('name')}</th><th>{t('teamScope')}</th><th>{t('category')}</th>
            <th>{t('priority')}</th><th>{t('estPrice')}</th><th>{t('quantity')}</th><th>{t('total')}</th>
            <th>{t('fundFrom')}</th>
          </tr></thead>
          <tbody>
            {priced.map((r) => (
              <tr key={r.id} style={picked.has(r.id) ? { background: 'rgba(255,145,0,.07)' } : undefined}>
                <td><input type="checkbox" checked={picked.has(r.id)} onChange={() => toggle(r.id)} style={{ width: 'auto' }} /></td>
                <td>{r.name}</td>
                <td><TeamScopeBadge scope={r.team_scope} /></td>
                <td>{lk.categoryName[r.category_id] || '—'}</td>
                <td>{lk.levelName[r.priority_level_id] || '—'}</td>
                <td className="num mono">{money(r.est_price)}</td>
                <td className="num">{qtyOf(r)}</td>
                <td className="num mono">{money(cost(r))}</td>
                <td>
                  {/* Only meaningful once the row is actually in the plan. */}
                  <select value={accountFor(r.id)} disabled={!picked.has(r.id)}
                    onChange={(e) => setFundBy({ ...fundBy, [r.id]: e.target.value })}
                    style={{ minWidth: '8rem', opacity: picked.has(r.id) ? 1 : .45 }}>
                    {lk.accountsActive.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!priced.length && <div className="empty">{t('noPricedItems')}</div>}
      </div>

      {unpriced.length > 0 && (
        <p style={{ color: 'var(--text-faint)', fontSize: 13 }}>
          {t('unpricedExcluded').replace('{n}', unpriced.length)}
        </p>
      )}
    </div>
  )
}

function Stat({ k, v, c }) {
  return (
    <div className="stat panel">
      <div className="k">{k}</div>
      <div className="v" style={{ color: c, fontSize: 24 }}>{v}</div>
    </div>
  )
}
