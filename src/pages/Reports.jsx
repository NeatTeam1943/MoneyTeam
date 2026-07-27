import { useEffect, useMemo, useState } from 'react'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts'
import { supabase, withTimeout } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useSeason } from '../context/SeasonContext'
import { useI18n } from '../lib/i18n'
import { useToast } from '../lib/toast'
import { useLookups } from '../lib/useLookups'
import { useTeamScope } from '../context/TeamScopeContext'
import { money, fmtDate, monthKey, typeColor, amountColor, signedColor } from '../lib/format'
import { exportReport } from '../lib/export'

const axis = { fontSize: 12, fill: '#4c5570', fontFamily: 'Space Mono, monospace' }
const tip = { background: '#fff', border: '1px solid #c6cde0', borderRadius: 8, fontSize: 13, color: '#151a2b' }
const iso = (d) => d.toISOString().slice(0, 10)

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
      const [tx, tl, bg] = await withTimeout(Promise.all([
        supabase.from('transactions').select('*').eq('season_id', activeId),
        supabase.from('transaction_lines').select('amount,budget_id,description,transactions!inner(season_id,date,team_scope)').eq('transactions.season_id', activeId),
        supabase.from('budgets').select('*').eq('season_id', activeId),
      ]))
      if (!tx.error) setRows(tx.data || [])
      if (!tl.error) setLines(tl.data || [])
      if (!bg.error) setBudgets(bg.data || [])
    } catch (e) {
      if (e.message === 'timeout') toast.error(t('loadTimedOut'))
    } finally { setLoading(false) }
  }
  useEffect(() => { if (uid) load(); else setLoading(false) }, [activeId, uid])   // eslint-disable-line react-hooks/exhaustive-deps

  const inPeriod = (d) => (!from || d >= from) && (!to || d <= to)

  const scoped = useMemo(
    () => rows.filter((r) => ts.matches(r.team_scope) && inPeriod(r.date)),
    [rows, ts, from, to])   // eslint-disable-line react-hooks/exhaustive-deps

  const scopedLines = useMemo(
    () => lines.filter((l) => ts.matches(l.transactions?.team_scope) && inPeriod(l.transactions?.date)),
    [lines, ts, from, to])  // eslint-disable-line react-hooks/exhaustive-deps

  const totals = useMemo(() => {
    let income = 0, expense = 0, inkind = 0
    for (const r of scoped) {
      if (r.type === 'income') income += Number(r.amount)
      else if (r.type === 'expense') expense += Number(r.amount)
      else if (r.type === 'in_kind') inkind += Number(r.amount)
    }
    return { income, expense, inkind, net: income - expense }
  }, [scoped])

  const byMonth = useMemo(() => {
    const m = {}
    for (const r of scoped) {
      if (r.type !== 'income' && r.type !== 'expense') continue
      const k = monthKey(r.date)
      m[k] = m[k] || { month: k, income: 0, expense: 0 }
      m[k][r.type] += Number(r.amount)
    }
    return Object.values(m).sort((a, b) => a.month.localeCompare(b.month))
  }, [scoped])

  const budgetCat = useMemo(() => Object.fromEntries(budgets.map((b) => [b.id, b.category_id])), [budgets])

  const byCategory = useMemo(() => {
    const m = {}
    for (const l of scopedLines) {
      const k = lk.categoryName[budgetCat[l.budget_id]] || t('uncategorized')
      m[k] = (m[k] || 0) + Number(l.amount)
    }
    return Object.entries(m).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
  }, [scopedLines, budgetCat, lk.categoryName, t])

  const bySource = useMemo(() => {
    const m = {}
    for (const r of scoped) {
      if (r.type !== 'income') continue
      const k = lk.sourceName[r.income_source_id] || '—'
      m[k] = (m[k] || 0) + Number(r.amount)
    }
    return Object.entries(m).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
  }, [scoped, lk.sourceName])

  // Net movement per account for the period. A transfer leaves one account and
  // lands in another, so it appears on both sides — the pair nets to zero
  // overall but still shows where money actually moved.
  const byAccount = useMemo(() => {
    const m = {}
    const add = (id, v) => { if (id) m[id] = (m[id] || 0) + v }
    for (const r of scoped) {
      const amt = Number(r.amount)
      if (r.type === 'income') add(r.account_id, amt)
      else if (r.type === 'expense') add(r.account_id, -amt)
      else if (r.type === 'transfer') { add(r.account_id, -amt); add(r.to_account_id, amt) }
    }
    return Object.entries(m)
      .map(([id, value]) => ({ name: lk.accountName[id] || '—', value }))
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
  }, [scoped, lk.accountName])

  const topExpenses = useMemo(
    () => scoped.filter((r) => r.type === 'expense')
      .sort((a, b) => Number(b.amount) - Number(a.amount)).slice(0, 10),
    [scoped])

  function doExport() {
    exportReport({
      periodLabel: `${from || '…'}_${to || '…'}`,
      seasonName: active?.name,
      totals, byMonth, byCategory, bySource, byAccount,
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
      <div className="toolbar">
        <div className="tabs" style={{ marginBottom: 0 }}>
          {presets.map((p) => (
            <button key={p} className={'tab' + (preset === p ? ' active' : '')} onClick={() => setPreset(p)}>{t('period_' + p)}</button>
          ))}
        </div>
        <input type="date" value={from} onChange={(e) => { setPreset('custom'); setFrom(e.target.value) }} title={t('from')} />
        <input type="date" value={to} onChange={(e) => { setPreset('custom'); setTo(e.target.value) }} title={t('to')} />
        <div className="spacer" />
        <button className="btn" onClick={doExport}>{t('export')}</button>
      </div>

      <div className="stats">
        <Stat k={t('totalIncome')} v={money(totals.income)} c="var(--in)" />
        <Stat k={t('totalExpense')} v={money(totals.expense)} c="var(--out)" />
        <Stat k={t('net')} v={money(totals.net)} c={signedColor(totals.net)} />
        <Stat k={t('totalInKind')} v={money(totals.inkind)} c="var(--inkind)" />
        <Stat k={t('txCount')} v={String(scoped.length)} c="var(--text)" />
      </div>

      {loading ? <div className="panel empty">{t('loading')}</div> : !scoped.length ? (
        <div className="panel empty">{t('noRowsInPeriod')}</div>
      ) : (
        <>
          <div className="section-title">{t('incomeVsExpense')}</div>
          <div className="panel panel-pad" style={{ height: 280, direction: 'ltr' }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={byMonth} margin={{ top: 6, right: 8, left: 8, bottom: 6 }}>
                <CartesianGrid stroke="#dde2ee" vertical={false} />
                <XAxis dataKey="month" tick={axis} /><YAxis tick={axis} width={64} />
                <Tooltip contentStyle={tip} formatter={(v) => money(v)} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="income" name={t('income')} fill={typeColor.income} radius={[3, 3, 0, 0]} />
                <Bar dataKey="expense" name={t('expense')} fill={typeColor.expense} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="grid-2" style={{ marginTop: 16 }}>
            <Breakdown title={t('byCategory')} rows={byCategory} />
            <Breakdown title={t('bySource')} rows={bySource} />
          </div>
          <div className="grid-2" style={{ marginTop: 14 }}>
            <Breakdown title={t('byAccount')} rows={byAccount} signed />
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

function Breakdown({ title, rows, signed }) {
  const { t } = useI18n()
  const total = rows.reduce((s, r) => s + r.value, 0)
  return (
    <div className="panel panel-pad">
      <div className="section-title" style={{ marginTop: 0 }}>{title}</div>
      {!rows.length ? <div className="empty">{t('noRows')}</div> : (
        <table className="data">
          <tbody>
            {rows.map((r) => (
              <tr key={r.name}>
                <td>{r.name}</td>
                <td className="num mono" style={{ color: signed ? amountColor(r.value) : undefined }}>{money(r.value)}</td>
                <td className="num mono" style={{ color: 'var(--text-faint)', width: 60 }}>
                  {total ? Math.round((Math.abs(r.value) / Math.abs(total)) * 100) + '%' : '—'}
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
