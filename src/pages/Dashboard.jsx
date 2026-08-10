import { useEffect, useMemo, useState } from 'react'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  PieChart, Pie, Cell, Legend,
} from 'recharts'
import { supabase } from '../lib/supabase'
import { fetchCached } from '../lib/seasonCache'
import { useRefreshOnReturn } from '../lib/useRefreshOnReturn'
import { useSeason } from '../context/SeasonContext'
import { useAuth } from '../context/AuthContext'
import { useI18n } from '../lib/i18n'
import { useLookups } from '../lib/useLookups'
import { spendableAfterGoals } from '../domain/goals'
import { money, monthKey, typeColor, amountColor } from '../lib/format'
import { useTeamScope } from '../context/TeamScopeContext'
import { linesByTransaction, attributableAmount, touchesScope, exclusiveVsShared } from '../lib/teamScope'
import ScopeNotice from '../components/ScopeNotice'
import ShareTable from '../components/ShareTable'
import { totalsOf, byMonthOf, overBudgetOf, topAncestorNameFactory, groupSum } from '../domain/ledger'
import { GROUPING } from '../domain/constants'

// Axis labels and grid lines follow the theme too: #4c5570 on a dark panel is
// 2.3:1 and #dde2ee grid lines glow. SVG resolves CSS variables the same way
// the rest of the app does.
const axis = { fontSize: 12, fill: 'var(--text-dim)', fontFamily: 'Space Mono, monospace' }
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
  const [opening, setOpening] = useState(null)
  const [goals, setGoals] = useState([])
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
    supabase.from(isParent ? 'transactions_guest' : 'ledger_transactions').select('*').eq('season_id', activeId)
      .then(({ data, error }) => { if (!error) setAllRows(data || []) })
    supabase.from(isParent ? 'account_balances_guest' : 'account_balances').select('*')
      .then(({ data, error }) => { if (!error) setBalances(data || []) })
    // What the accounts held the day this season opened. Derived, not
    // stored: the sum of every approved movement before the start date,
    // so it cannot drift when someone back-dates a transaction.
    supabase.from('savings_goals').select('reserved,team_scope')
      .then(({ data, error }) => { if (!error) setGoals(data || []) })
    supabase.rpc('season_opening_balances', { p_season_id: activeId })
      .then(({ data, error }) => { if (!error) setOpening(data || []) })
    if (isParent) return
    fetchCached('budgets', { seasonId: activeId })
      .then(({ data, error }) => { if (!error) setBudgets(data || []) })
    supabase.from('ledger_lines_full').select('transaction_id,amount,budget_id,team_scope,category_id,season_id,tx_team_scope').eq('season_id', activeId)
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
  useRefreshOnReturn(loadDashboard, { enabled: !!(activeId && uid), deps: [activeId, uid] })

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

  // The real money: what the accounts actually hold, carry-over included.
  // Never program-filtered — accounts are shared, and a filtered balance would
  // be a number that does not exist anywhere.
  const cashOnHand = useMemo(
    () => balances.reduce((s, b) => s + (Number(b.balance) || 0), 0), [balances])

  // Under a single-program filter, how much of the expense is that program's
  // alone and how much is shared. Null in the full view, where the question
  // does not arise.
  const split = useMemo(() => exclusiveVsShared(allRows, byTx, ts), [allRows, byTx, ts])

  // Null until it loads, and null is not 0 — a season that genuinely opened at
  // zero should say 0, while "not loaded" should show nothing at all.
  const openingTotal = useMemo(
    () => (opening ? opening.reduce((s, b) => s + (Number(b.balance) || 0), 0) : null),
    [opening])

  // Reserved money is a third quantity — not a budget, not a request — so it
  // is shown by subtracting it from what can be spent rather than folded into
  // either total.
  const spendable = useMemo(
    () => spendableAfterGoals(cashOnHand, goals.filter((g) => ts.matches(g.team_scope))),
    [cashOnHand, goals, ts])

  const overBudget = useMemo(() => overBudgetOf({
    budgets, allRows, allLines, matchesTeam: ts.matches, allProgramsShown: ts.all,
    // Needed so a parent pot does not re-count its children's overspend.
    parentOf: Object.fromEntries(categories.map((c) => [c.id, c.parent_id])),
  }), [allRows, allLines, budgets, ts, categories])

  const byMonth = useMemo(() => byMonthOf(rows, monthKey), [rows])

  const budgetCat = useMemo(() => Object.fromEntries(budgets.map((b) => [b.id, b.category_id])), [budgets])

  // Same direct/parent toggle as the Shopping and Budgets pages — 'direct'
  // never rolls a child (e.g. אוכל) into its parent (תחרויות); 'parent' sums
  // every category into its top-level ancestor.
  const [categoryGrouping, setCategoryGrouping] = useState(GROUPING.DIRECT)
  const topAncestorName = useMemo(
    () => topAncestorNameFactory(categories, categoryName), [categories, categoryName])

  const byCategory = useMemo(() => groupSum(lines, (l) => {
    // Line category first — see Reports.
    const catId = l.category_id || budgetCat[l.budget_id]
    return (categoryGrouping === GROUPING.PARENT ? topAncestorName(catId) : categoryName[catId]) || t('overall')
  }), [lines, categoryName, budgetCat, t, categoryGrouping, topAncestorName])
  const bySource = useMemo(() => groupSum(rows.filter((r) => r.type === 'income'), (r) => sourceName[r.income_source_id] || '—'), [rows, sourceName])

  return (
    <div>
      <ScopeNotice />
      <div className="stats">
        <Stat k={t('totalIncome')} v={money(totals.income)} c="var(--in)" />
        <Stat k={t('totalExpense')} v={money(totals.expense)} c="var(--out)" />
        {/* The sum of every account balance, beside the season net.
            They answer different questions: net is "did this season earn more
            than it spent" and can be negative for a good reason; this is "how
            much money is actually there". With no income yet this season the
            net is negative and correct — but on its own it reads as "we have
            nothing", which is not true. */}
        {openingTotal !== null && (
          <Stat k={t('openingBalance')} v={money(openingTotal)} c="var(--text-dim)" />
        )}
        {spendable.reserved > 0 && (
          <Stat k={t('availableAfterGoals')} v={money(spendable.available)}
            c={spendable.overReserved ? 'var(--danger)' : 'var(--ok)'} />
        )}
        <Stat k={t('balanceOnHand')} v={money(cashOnHand)}
          c={cashOnHand < 0 ? 'var(--danger)' : 'var(--ok)'} />
        {split && (
          <>
            <Stat k={t('expenseOnlyFor').replace('{p}', split.program.toUpperCase())}
              v={money(split.exclusive)} c="var(--out)" />
            <Stat k={t('expenseShared')} v={money(split.shared)} c="var(--text-dim)" />
          </>
        )}
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
            <CartesianGrid stroke="var(--line)" vertical={false} />
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
              </PieChart>
            </ResponsiveContainer>
          </div>
          {/* The legend is replaced by the table: a legend names the slices but
              still cannot tell you what a 0.05% one is worth, and the table
              does both. */}
          <ShareTable rows={byCategory} colors={CATCOLORS} />
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

// Reads the theme's variables rather than baking in light colours — a white
// tooltip on a dark chart is a bright rectangle nobody can read.
const tip = {
  background: 'var(--panel)',
  border: '1px solid var(--line-strong)',
  borderRadius: 8,
  fontSize: 13,
  color: 'var(--text)',
}

function Stat({ k, v, c, small }) {
  return (
    <div className="stat panel">
      <div className="k">{k}</div>
      {/* No inline fontSize. It overrode every responsive rule in index.css —
          which is why the figures kept overflowing their cards on a phone no
          matter what the clamp said. Size belongs to the stylesheet, which can
          see the viewport; a `small` variant is a class, not a number. */}
      <div className={'v' + (small ? ' v-small' : '')} style={{ color: c }}>{v}</div>
    </div>
  )
}
