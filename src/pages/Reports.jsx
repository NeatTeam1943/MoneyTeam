import { useEffect, useMemo, useState } from 'react'
import DateField from '../components/DateField'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
  LineChart, Line, PieChart, Pie, Cell, ReferenceLine } from 'recharts'
import { supabase, withTimeout } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useSeason } from '../context/SeasonContext'
import { useI18n } from '../lib/i18n'
import { useToast } from '../lib/toast'
import { useLookups } from '../lib/useLookups'
import { useTeamScope } from '../context/TeamScopeContext'
import { linesByTransaction, attributableAmount, touchesScope, spendByScope } from '../lib/teamScope'
import ScopeNotice from '../components/ScopeNotice'
import {
  totalsOf, byMonthOf, cumulativeOf, byCategoryOf, bySourceOf,
  byVendorOf, byAccountOf, topExpensesOf,
} from '../domain/ledger'
import { TOP_EXPENSES_LIMIT, TOP_VENDORS_LIMIT, TX, GROUPING, OPEN_STATUSES } from '../domain/constants'
import { buildBudgetRows } from '../domain/budgets'
import { money, fmtDate, monthKey, typeColor, amountColor, signedColor, lineTotal } from '../lib/format'
import { exportReport } from '../lib/export'

// Axis labels and grid lines follow the theme too: #4c5570 on a dark panel is
// 2.3:1 and #dde2ee grid lines glow. SVG resolves CSS variables the same way
// the rest of the app does.
const axis = { fontSize: 12, fill: 'var(--text-dim)', fontFamily: 'Space Mono, monospace' }
// Reads the theme's variables rather than baking in light colours — a white
// tooltip on a dark chart is a bright rectangle nobody can read.
const tip = {
  background: 'var(--panel)',
  border: '1px solid var(--line-strong)',
  borderRadius: 8,
  fontSize: 13,
  color: 'var(--text)',
}
const iso = (d) => d.toISOString().slice(0, 10)
const SCOPE_FILL = { frc: '#1100ff', ftc: '#c8102e', both: '#5b6472' }
// #e0384c dropped: too close to both --danger and the FTC red to be a
// neutral category colour.
const CATFILL = ['#1100ff', '#ff9100', '#00a86b', '#c026d3', '#0891b2', '#0f766e', '#7c3aed', '#65a30d']

// Presets are computed from today, not from the season, so "this month" means
// this month even when you are looking at a past season. Picking a preset that
// lands outside the selected season simply yields an empty period — that is
// honest, and the custom range is right there.
function presetRange(key, season) {
  const now = new Date()
  const y = now.getFullYear(), m = now.getMonth()
  switch (key) {
    case 'thisMonth':  return [iso(new Date(y, m, 1)), iso(new Date(y, m + 1, 0))]
    case 'lastMonth':  return [iso(new Date(y, m - 1, 1)), iso(new Date(y, m, 0))]
    case 'thisQuarter': {
      const q = Math.floor(m / 3) * 3
      return [iso(new Date(y, q, 1)), iso(new Date(y, q + 3, 0))]
    }
    case 'thisYear':   return [iso(new Date(y, 0, 1)), iso(new Date(y, 11, 31))]
    case 'season':     return [season?.start_date || '', season?.end_date || '']
    default:           return ['', '']
  }
}

export default function Reports() {
  const { t } = useI18n()
  const { session } = useAuth()
  const uid = session?.user?.id
  const { activeId, active } = useSeason()
  const toast = useToast()
  const lk = useLookups()
  const ts = useTeamScope()

  const [rows, setRows] = useState([])
  const [lines, setLines] = useState([])
  const [budgets, setBudgets] = useState([])
  const [shopping, setShopping] = useState([])
  const [loading, setLoading] = useState(true)

  const [preset, setPreset] = useState('season')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  useEffect(() => {
    if (preset === 'custom') return
    const [a, b] = presetRange(preset, active)
    setFrom(a); setTo(b)
  }, [preset, active])

  async function load() {
    if (!activeId) { setLoading(false); return }
    if (rows.length === 0) setLoading(true)
    try {
      const [tx, tl, bg, sh] = await withTimeout(Promise.all([
        supabase.from('ledger_transactions').select('*').eq('season_id', activeId),
        supabase.from('ledger_lines_full').select('transaction_id,amount,budget_id,description,team_scope,category_id,season_id,date,tx_team_scope').eq('season_id', activeId),
        supabase.from('budgets').select('*').eq('season_id', activeId),
        supabase.from('shopping_items').select('*').eq('season_id', activeId),
      ]))
      if (!tx.error) setRows(tx.data || [])
      if (!tl.error) setLines(tl.data || [])
      if (!bg.error) setBudgets(bg.data || [])
      if (!sh.error) setShopping(sh.data || [])
    } catch (e) {
      if (e.message === 'timeout') toast.error(t('loadTimedOut'))
    } finally { setLoading(false) }
  }
  useEffect(() => { if (uid) load(); else setLoading(false) }, [activeId, uid])   // eslint-disable-line react-hooks/exhaustive-deps

  const inPeriod = (d) => (!from || d >= from) && (!to || d <= to)

  const byTx = useMemo(() => linesByTransaction(lines), [lines])

  // Amounts are re-attributed line by line, so a receipt that mixes FRC, FTC
  // and shared items contributes only its matching share to a filtered view.
  const scoped = useMemo(
    () => rows.filter((r) => inPeriod(r.date) && touchesScope(r, byTx, ts))
      .map((r) => ({ ...r, amount: attributableAmount(r, byTx, ts) }))
      .filter((r) => r.amount > 0 || ts.all),
    [rows, byTx, ts, from, to])   // eslint-disable-line react-hooks/exhaustive-deps

  const scopedLines = useMemo(
    () => lines.filter((l) => ts.matches(l.team_scope) && inPeriod(l.date)),
    [lines, ts, from, to])  // eslint-disable-line react-hooks/exhaustive-deps

  const totals = useMemo(() => totalsOf(scoped, ts.all), [scoped, ts])

  const byMonth = useMemo(() => byMonthOf(scoped, monthKey), [scoped])

  const budgetCat = useMemo(() => Object.fromEntries(budgets.map((b) => [b.id, b.category_id])), [budgets])

  const byCategory = useMemo(
    // The line's own category wins; the paying budget's category is the fallback
    // for rows created before migration 21. Reporting granularity is no longer
    // limited by how finely you chose to budget.
    () => byCategoryOf(scopedLines, (l) =>
      lk.categoryName[l.category_id || budgetCat[l.budget_id]] || t('uncategorized')),
    [scopedLines, budgetCat, lk.categoryName, t])

  const bySource = useMemo(
    () => bySourceOf(scoped, (r) => lk.sourceName[r.income_source_id] || '—'),
    [scoped, lk.sourceName])

  const byAccount = useMemo(
    () => byAccountOf(scoped, (id) => lk.accountName[id] || '—'),
    [scoped, lk.accountName])

  const cumulative = useMemo(() => cumulativeOf(byMonth), [byMonth])

  const byVendor = useMemo(
    () => byVendorOf(scoped, (r) => r.vendor || t('uncategorized'), TOP_VENDORS_LIMIT),
    [scoped, t])

  const byScope = useMemo(() => {
    const inPeriodTx = rows.filter((r) => inPeriod(r.date))
    const m = spendByScope(inPeriodTx, byTx)
    return Object.entries(m).filter(([, v]) => v > 0)
      .map(([k, value]) => ({ key: k, name: t('scope_' + k), value }))
  }, [rows, byTx, t, from, to])   // eslint-disable-line react-hooks/exhaustive-deps

  const expenseCount = scoped.filter((r) => r.type === TX.EXPENSE).length

  // Budget utilisation, using the same ownership model as the Budgets page so
  // the two never disagree.
  const budgetRows = useMemo(() => buildBudgetRows(GROUPING.PARENT, {
    budgets: budgets.filter((b) => ts.matches(b.team_scope)),
    expenses: lines,
    shopping,
    budgetCategory: Object.fromEntries(budgets.map((b) => [b.id, b.category_id])),
    descendantsOf: lk.descendantsOf,
    labelFor: (b) => (b.category_id ? (lk.categoryName[b.category_id] || t('uncategorized')) : t('overall'))
      + ((b.team_scope && b.team_scope !== 'both') ? ` · ${b.team_scope.toUpperCase()}` : ''),
    matchesTeam: ts.matches,
    allTicked: ts.all,
    parentOf: lk.parentOf,
  }).filter((r) => r.amount > 0 || r.spent > 0),
    [budgets, lines, shopping, lk, t, ts])

  const budgetChart = useMemo(
    () => budgetRows.map((r) => ({ name: r.label, [t('spent')]: r.spent, [t('budget')]: r.amount })),
    [budgetRows, t])

  // Wish list still outstanding, by category — the Shopping page's view.
  const requestedChart = useMemo(() => {
    const m = {}
    for (const r of shopping) {
      if (!OPEN_STATUSES.includes(r.status)) continue
      if (!ts.matches(r.team_scope)) continue
      const k = lk.categoryName[r.category_id] || t('uncategorized')
      m[k] = (m[k] || 0) + lineTotal(r)
    }
    return Object.entries(m).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
  }, [shopping, lk.categoryName, t, ts])

  const topExpenses = useMemo(() => topExpensesOf(scoped, TOP_EXPENSES_LIMIT), [scoped])

  function doExport() {
    exportReport({
      periodLabel: `${from || '…'} → ${to || '…'}`,
      scope: { all: ts.all, frc: ts.frc, ftc: ts.ftc },
      rowCount: scoped.length,
      seasonName: active?.name,
      totals, byMonth, byCategory, bySource, byAccount, byVendor, byScope, cumulative,
      topExpenses: topExpenses.map((r) => ({
        Date: fmtDate(r.date),
        Amount: Number(r.amount),
        Vendor: r.vendor || '',
        Description: r.description || '',
        Account: lk.accountName[r.account_id] || '',
      })),
    })
  }

  const presets = ['thisMonth', 'lastMonth', 'thisQuarter', 'thisYear', 'season', 'custom']

  return (
    <div>
      <ScopeNotice />
      <div className="toolbar">
        <div className="tabs" style={{ marginBottom: 0 }}>
          {presets.map((p) => (
            <button key={p} className={'tab' + (preset === p ? ' active' : '')} onClick={() => setPreset(p)}>{t('period_' + p)}</button>
          ))}
        </div>
        <DateField value={from} onChange={(e) => { setPreset('custom'); setFrom(e.target.value) }} title={t('from')} />
        <DateField value={to} onChange={(e) => { setPreset('custom'); setTo(e.target.value) }} title={t('to')} />
        <div className="spacer" />
        <button className="btn" onClick={doExport}>{t('export')}</button>
      </div>

      <div className="stats">
        <Stat k={t('totalIncome')} v={money(totals.income)} c="var(--in)" />
        <Stat k={t('totalExpense')} v={money(totals.expense)} c="var(--out)" />
        <Stat k={t('net')} v={totals.net === null ? '—' : money(totals.net)}
          c={totals.net === null ? 'var(--text-faint)' : signedColor(totals.net)} />
        <Stat k={t('txCount')} v={String(scoped.length)} c="var(--text)" />
        <Stat k={t('avgExpense')} v={expenseCount ? money(totals.expense / expenseCount) : '—'} c="var(--out)" />
      </div>

      {loading ? <div className="panel empty">{t('loading')}</div> : !scoped.length ? (
        <div className="panel empty">{t('noRowsInPeriod')}</div>
      ) : (
        <>
          <Chart title={t('incomeVsExpense')} note={t('noteIncomeVsExpense')}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={byMonth} margin={{ top: 6, right: 8, left: 8, bottom: 6 }}>
                <CartesianGrid stroke="var(--line)" vertical={false} />
                <XAxis dataKey="month" tick={axis} /><YAxis tick={axis} width={64} />
                <Tooltip contentStyle={tip} formatter={(v) => money(v)} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="income" name={t('income')} fill={typeColor.income} radius={[3, 3, 0, 0]} />
                <Bar dataKey="expense" name={t('expense')} fill={typeColor.expense} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Chart>

          <Chart title={t('cumulativeNet')} note={t('noteCumulative')}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={cumulative} margin={{ top: 6, right: 8, left: 8, bottom: 6 }}>
                <CartesianGrid stroke="var(--line)" vertical={false} />
                <XAxis dataKey="month" tick={axis} /><YAxis tick={axis} width={72} />
                <Tooltip contentStyle={tip} formatter={(v) => money(v)} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <ReferenceLine y={0} stroke="#9aa3b8" />
                <Line type="monotone" dataKey="cumulative" name={t('cumulativeNet')} stroke="#1100ff" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="net" name={t('monthlyNet')} stroke="#ff9100" strokeWidth={1.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </Chart>

          <div className="charts" style={{ marginTop: 16 }}>
            <Chart title={t('byVendor')} note={t('noteByVendor')}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={byVendor} layout="vertical" margin={{ left: 8, right: 16 }}>
                    <XAxis type="number" tick={axis} />
                    <YAxis type="category" dataKey="name" tick={axis} width={130} interval={0} />
                    <Tooltip contentStyle={tip} formatter={(v) => money(v)} />
                    <Bar dataKey="value" radius={[0, 3, 3, 0]}>
                      {byVendor.map((_, i) => <Cell key={i} fill={CATFILL[i % CATFILL.length]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
            </Chart>
            <Chart title={t('byScope')} note={t('noteByScope')}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={byScope} dataKey="value" nameKey="name" outerRadius={95} innerRadius={50}>
                      {byScope.map((d) => <Cell key={d.key} fill={SCOPE_FILL[d.key]} />)}
                    </Pie>
                    <Tooltip contentStyle={tip} formatter={(v) => money(v)} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
            </Chart>
          </div>


          {/* The same views the other pages show, so a report is the whole
              picture rather than a subset someone has to supplement. */}
          <div className="charts" style={{ marginTop: 16 }}>
            <Chart title={t('byCategory')} note={t('noteByCategoryChart')}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={byCategory} dataKey="value" nameKey="name" outerRadius={90} innerRadius={48}>
                    {byCategory.map((_, i) => <Cell key={i} fill={CATFILL[i % CATFILL.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={tip} formatter={(v) => money(v)} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            </Chart>

            <Chart title={t('bySource')} note={t('noteBySourceChart')}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={bySource} dataKey="value" nameKey="name" outerRadius={90} innerRadius={48}>
                    {bySource.map((_, i) => <Cell key={i} fill={CATFILL[(i + 3) % CATFILL.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={tip} formatter={(v) => money(v)} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            </Chart>
          </div>

          <Chart title={t('budgetUse')} note={t('noteBudgetUse')} height="chart-box-tall">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={budgetChart} layout="vertical" margin={{ left: 8, right: 16 }}>
                <CartesianGrid stroke="var(--line)" horizontal={false} />
                <XAxis type="number" tick={axis} />
                <YAxis type="category" dataKey="name" tick={axis} width={150} interval={0} />
                <Tooltip contentStyle={tip} formatter={(v) => money(v)} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey={t('budget')} fill="#c6cde0" radius={[0, 3, 3, 0]} />
                <Bar dataKey={t('spent')} fill={typeColor.expense} radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Chart>

          {requestedChart.length > 0 && (
            <Chart title={t('requestedByCategory')} note={t('noteRequested')}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={requestedChart} layout="vertical" margin={{ left: 8, right: 16 }}>
                  <XAxis type="number" tick={axis} />
                  <YAxis type="category" dataKey="name" tick={axis} width={150} interval={0} />
                  <Tooltip contentStyle={tip} formatter={(v) => money(v)} />
                  <Bar dataKey="value" radius={[0, 3, 3, 0]}>
                    {requestedChart.map((_, i) => <Cell key={i} fill={CATFILL[(i + 5) % CATFILL.length]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Chart>
          )}

          <div className="grid-2" style={{ marginTop: 16 }}>
            <Breakdown title={t('byCategory')} note={t('noteByCategoryTable')} rows={byCategory} />
            <Breakdown title={t('bySource')} note={t('noteBySourceTable')} rows={bySource} />
          </div>
          <div className="grid-2" style={{ marginTop: 14 }}>
            <Breakdown title={t('byAccount')} note={t('noteByAccount')} rows={byAccount} signed />
            <div className="panel panel-pad">
              <div className="section-title" style={{ marginTop: 0 }}>{t('topExpenses')}</div>
              <table className="data">
                <tbody>
                  {topExpenses.map((r) => (
                    <tr key={r.id}>
                      <td className="mono" style={{ whiteSpace: 'nowrap' }}>{fmtDate(r.date)}</td>
                      <td style={{ color: 'var(--text-dim)' }}>{r.description || r.vendor || '—'}</td>
                      <td className="num mono">{money(r.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// A chart with its title and a one-line note. The note matters: a reader who
// has to work out what "מאזן מצטבר" counts will guess, and guessing at a
// finance figure is how the wrong number gets quoted in a meeting.
function Chart({ title, note, height, children }) {
  return (
    <div className="panel panel-pad">
      <div className="section-title" style={{ marginTop: 0, marginBottom: 2 }}>{title}</div>
      <p style={{ color: 'var(--text-faint)', fontSize: 12, margin: '0 0 8px' }}>{note}</p>
      <div className={height || 'chart-box'} style={{ direction: 'ltr' }}>{children}</div>
    </div>
  )
}

function Breakdown({ title, note, rows, signed }) {
  const { t } = useI18n()
  // The denominator is the sum of ABSOLUTE values, not the signed sum.
  //
  // For a table of expenses those are the same thing. For "by account" they
  // are not: the values are net movement, so income and expense cancel and the
  // signed total collapses towards zero. Dividing absolute values by it gave
  // 77% + 51% + 75% = 203%. Each row's share of total movement is a number
  // that means something and adds to 100.
  const total = rows.reduce((s, r) => s + Math.abs(r.value), 0)
  return (
    <div className="panel panel-pad">
      <div className="section-title" style={{ marginTop: 0, marginBottom: 2 }}>{title}</div>
      <p style={{ color: 'var(--text-faint)', fontSize: 12, margin: '0 0 8px' }}>
        {note} {t('shareNote')}
      </p>
      {!rows.length ? <div className="empty">{t('noRows')}</div> : (
        <table className="data">
          <tbody>
            {rows.map((r) => (
              <tr key={r.name}>
                <td>{r.name}</td>
                <td className="num mono" style={{ color: signed ? amountColor(r.value) : undefined }}>{money(r.value)}</td>
                <td className="num mono" style={{ color: 'var(--text-faint)', width: 60 }}>
                  {total ? Math.round((Math.abs(r.value) / total) * 100) + '%' : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
