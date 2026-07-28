import { useEffect, useMemo, useState } from 'react'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  PieChart, Pie, Cell, Legend,
} from 'recharts'
import { supabase } from '../lib/supabase'
import { useSeason } from '../context/SeasonContext'
import { useAuth } from '../context/AuthContext'
import { useI18n } from '../lib/i18n'
import { useLookups } from '../lib/useLookups'
import { money, monthKey, typeColor, amountColor } from '../lib/format'
import { useTeamScope } from '../context/TeamScopeContext'
import { linesByTransaction, attributableAmount, touchesScope } from '../lib/teamScope'
import ScopeNotice from '../components/ScopeNotice'
import { totalsOf, byMonthOf, overBudgetOf, topAncestorNameFactory, groupSum } from '../domain/ledger'
import { GROUPING } from '../domain/constants'

const axis = { fontSize: 12, fill: '#4c5570', fontFamily: 'Space Mono, monospace' }
const CATCOLORS = ['#ff9100', '#4d63ff', '#b06bff', '#35c26b', '#ff4d5e', '#ffc14d', '#7aa0ff', '#d98aff']

export default function Dashboard() {
  const { t } = useI18n()
  const { activeId, active } = useSeason()
  const { session, isParent } = useAuth()
  const uid = session?.user?.id || (isParent ? 'guest' : null)
  const { categoryName, sourceName, categories } = useLookups()
  const ts = useTeamScope()
  const [allRows, setAllRows] = useState([])
  const [balances, setBalances] = useState([])
  const [budgets, setBudgets] = useState([])
  const [waitingRows, setWaitingRows] = useState([])
  const [allLines, setAllLines] = useState([])

  function loadDashboard() {
  // Guests have no session by design, so data loading keys off "may view"
  // rather than "is signed in" — otherwise the two parent screens render empty.
    if (!activeId || !uid) return
    // Guests read the column-censored views and skip the three sources they
    // have no grant on. Firing them anyway would just log RLS errors and draw
    // empty charts, which reads as "the team spent nothing" rather than
    // "you can't see this".
    supabase.from(isParent ? 'transactions_guest' : 'transactions').select('*').eq('season_id', activeId)
      .then(({ data, error }) => { if (!error) setAllRows(data || []) })
    supabase.from(isParent ? 'account_balances_guest' : 'account_balances').select('*')
      .then(({ data, error }) => { if (!error) setBalances(data || []) })
    if (isParent) return
    supabase.from('budgets').select('*').eq('season_id', activeId)
      .then(({ data, error }) => { if (!error) setBudgets(data || []) })
    supabase.from('transaction_lines').select('transaction_id,amount,budget_id,team_scope,transactions!inner(season_id,team_scope)').eq('transactions.season_id', activeId)
      .then(({ data, error }) => { if (!error) setAllLines(data || []) })
    // shopping items still waiting to be bought: not yet linked to a purchase
    // and not cancelled/received.
    supabase.from('shopping_items').select('id,status,transaction_id,team_scope').eq('season_id', activeId)
      .then(({ data }) => setWaitingRows(data || []))
  }

  useEffect(() => { loadDashboard() }, [activeId, uid, isParent])   // eslint-disable-line react-hooks/exhaustive-deps

  // Re-fetch on returning to the tab so a request Chrome dropped in the
  // background gets a fresh attempt. Already silent — these are individual
  // .then() updates, not a loading flag, so nothing blanks the dashboard.
  useEffect(() => {
    const onFocus = () => loadDashboard()
    const onVis = () => { if (!document.hidden) onFocus() }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVis)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [activeId, uid])

  // One place where the top-bar FRC/FTC checklist is applied, so every stat,
  // chart and total below is filtered consistently — nothing can be "filtered"
  // in one panel and not another.
  const byTx = useMemo(() => linesByTransaction(allLines), [allLines])
  // A mixed purchase is listed when it touches the ticked programs, but only
  // the matching LINES count toward the money — see src/lib/teamScope.js.
  const rows = useMemo(() => allRows
    .filter((r) => touchesScope(r, byTx, ts))
    .map((r) => ({ ...r, amount: attributableAmount(r, byTx, ts) }))
    .filter((r) => r.amount > 0 || ts.all),
  [allRows, byTx, ts])
  const lines = useMemo(() => allLines.filter((l) => ts.matches(l.team_scope)), [allLines, ts])
  const waiting = useMemo(() => waitingRows.filter(
    (s) => !s.transaction_id && s.status !== 'cancelled' && s.status !== 'received' && ts.matches(s.team_scope)
  ).length, [waitingRows, ts])

  const totals = useMemo(() => totalsOf(rows, ts.all), [rows, ts])

  const overBudget = useMemo(() => overBudgetOf({
    budgets, allRows, allLines, matchesTeam: ts.matches, allProgramsShown: ts.all,
  }), [allRows, allLines, budgets, ts])

  const byMonth = useMemo(() => byMonthOf(rows, monthKey), [rows])

  const budgetCat = useMemo(() => Object.fromEntries(budgets.map((b) => [b.id, b.category_id])), [budgets])

  // Same direct/parent toggle as the Shopping and Budgets pages — 'direct'
  // never rolls a child (e.g. אוכל) into its parent (תחרויות); 'parent' sums
  // every category into its top-level ancestor.
  const [categoryGrouping, setCategoryGrouping] = useState(GROUPING.DIRECT)
  const topAncestorName = useMemo(
    () => topAncestorNameFactory(categories, categoryName), [categories, categoryName])

  const byCategory = useMemo(() => groupSum(lines, (l) => {
    const catId = budgetCat[l.budget_id]
    return (categoryGrouping === GROUPING.PARENT ? topAncestorName(catId) : categoryName[catId]) || t('overall')
  }), [lines, categoryName, budgetCat, t, categoryGrouping, topAncestorName])
  const bySource = useMemo(() => groupSum(rows.filter((r) => r.type === 'income'), (r) => sourceName[r.income_source_id] || '—'), [rows, sourceName])

  return (
    <div>
      <ScopeNotice />
      <div className="stats">
        <Stat k={t('totalIncome')} v={money(totals.income)} c="var(--in)" />
        <Stat k={t('totalExpense')} v={money(totals.expense)} c="var(--out)" />
        <Stat k={t('net')} v={totals.net === null ? '—' : money(totals.net)}
          c={totals.net === null ? 'var(--text-faint)' : (totals.net >= 0 ? 'var(--ok)' : 'var(--danger)')} />
        {!isParent && <Stat k={t('overBudget')} v={overBudget.hasBudget ? money(overBudget.over) : '—'} c={overBudget.over > 0 ? 'var(--danger)' : 'var(--ok)'} />}
        {!isParent && <Stat k={t('waitingToBuy')} v={String(waiting)} c="var(--out)" />}
      </div>

      <div className="section-title">{t('accountBalances')}</div>
      <div className="stats">
        {balances.map((b) => <Stat key={b.id} k={b.name} v={money(b.balance)} c={amountColor(b.balance)} small />)}
        {!balances.length && <div className="empty">{t('noRows')}</div>}
      </div>

      <div className="section-title">{t('incomeVsExpense')} · {active?.name || ''}</div>
      <div className="panel panel-pad chart-box-tall" style={{ direction: 'ltr' }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={byMonth} margin={{ top: 6, right: 8, left: 8, bottom: 6 }}>
            <CartesianGrid stroke="#dde2ee" vertical={false} />
            <XAxis dataKey="month" tick={axis} />
            <YAxis tick={axis} width={60} />
            <Tooltip contentStyle={tip} formatter={(v) => money(v)} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="income" name={t('income')} fill={typeColor.income} radius={[3, 3, 0, 0]} />
            <Bar dataKey="expense" name={t('expense')} fill={typeColor.expense} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="charts" style={{ marginTop: 16 }}>
        {!isParent && <div className="panel panel-pad">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <div className="section-title" style={{ marginTop: 0, marginBottom: 0 }}>{t('byCategory')}</div>
            <div className="tabs" style={{ marginBottom: 0 }}>
              <button className={'tab' + (categoryGrouping === 'direct' ? ' active' : '')} onClick={() => setCategoryGrouping('direct')}>{t('directOnly')}</button>
              <button className={'tab' + (categoryGrouping === 'parent' ? ' active' : '')} onClick={() => setCategoryGrouping('parent')}>{t('groupByParent')}</button>
            </div>
          </div>
          <div className="chart-box" style={{ direction: 'ltr' }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={byCategory} dataKey="value" nameKey="name" outerRadius={90} innerRadius={48}>
                  {byCategory.map((_, i) => <Cell key={i} fill={CATCOLORS[i % CATCOLORS.length]} />)}
                </Pie>
                <Tooltip contentStyle={tip} formatter={(v) => money(v)} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>}
        <div className="panel panel-pad">
          <div className="section-title" style={{ marginTop: 0 }}>{t('bySource')}</div>
          <div className="chart-box" style={{ direction: 'ltr' }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={bySource} layout="vertical" margin={{ left: 8, right: 16 }}>
                <XAxis type="number" tick={axis} allowDecimals={false} />
                <YAxis type="category" dataKey="name" tick={axis} width={130} interval={0} />
                <Tooltip contentStyle={tip} formatter={(v) => money(v)} />
                <Bar dataKey="value" fill={typeColor.income} radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  )
}

const tip = { background: '#ffffff', border: '1px solid #c6cde0', borderRadius: 8, fontSize: 13, color: '#151a2b' }

function Stat({ k, v, c, small }) {
  return (
    <div className="stat panel">
      <div className="k">{k}</div>
      <div className="v" style={{ color: c, fontSize: small ? 20 : 26 }}>{v}</div>
    </div>
  )
}
