import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useSeason } from '../context/SeasonContext'
import { useI18n } from '../lib/i18n'
import { useToast } from '../lib/toast'
import { useLookups } from '../lib/useLookups'
import { money, fmtDate, typePill, TX_TYPES } from '../lib/format'
import { exportTransactions, downloadAllReceipts } from '../lib/export'
import TransactionForm from '../components/TransactionForm'

export default function Transactions() {
  const { t } = useI18n()
  const { canTransact, session } = useAuth()
  const { activeId, active } = useSeason()
  const toast = useToast()
  const lk = useLookups()
  const [rows, setRows] = useState([])
  const [budgets, setBudgets] = useState([])
  const [txLines, setTxLines] = useState({})
  const [loading, setLoading] = useState(true)
  const [zipping, setZipping] = useState(null)   // null | 'n/total'
  const [balances, setBalances] = useState([])
  const [editing, setEditing] = useState(null)
  const [showForm, setShowForm] = useState(false)

  const [q, setQ] = useState('')
  const [fType, setFType] = useState('')
  const [fAccount, setFAccount] = useState('')
  const [fCategory, setFCategory] = useState('')
  const [fSource, setFSource] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [sort, setSort] = useState({ col: 'date', dir: 'desc' })

  async function load() {
    if (!activeId) { setLoading(false); return }
    setLoading(true)
    try {
      // All four queries in parallel — previously they ran one after another.
      const [tx, bal, bg, tl] = await Promise.all([
        supabase.from('transactions').select('*').eq('season_id', activeId),
        supabase.from('account_balances').select('*'),
        supabase.from('budgets').select('*').eq('season_id', activeId),
        supabase.from('transaction_lines').select('transaction_id,budget_id,amount,transactions!inner(season_id)').eq('transactions.season_id', activeId),
      ])
      if (!tx.error) setRows(tx.data || [])      // keep prior data if a query fails
      if (!bal.error) setBalances(bal.data || [])
      if (!bg.error) setBudgets(bg.data || [])
      if (!tl.error) {
        const map = {}
        for (const l of tl.data || []) (map[l.transaction_id] = map[l.transaction_id] || []).push(l)
        setTxLines(map)
      }
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    if (session?.user?.id) load()
    else setLoading(false)   // not signed in yet — don't sit on a spinner forever
  }, [activeId, session])

  const budgetOptions = useMemo(() => budgets.map((b) => ({
    id: b.id,
    label: b.category_id ? (lk.categoryTree.find((c) => c.id === b.category_id)?.path || lk.categoryName[b.category_id] || '—') : t('overall'),
  })), [budgets, lk.categoryTree, lk.categoryName, t])
  const budgetLabel = useMemo(() => Object.fromEntries(budgetOptions.map((b) => [b.id, b.label])), [budgetOptions])

  const enriched = useMemo(() => rows.map((r) => ({
    ...r,
    accountName: lk.accountName[r.account_id] || '',
    toAccountName: lk.accountName[r.to_account_id] || '',
    categoryName: lk.categoryName[r.category_id] || '',
    sourceName: lk.sourceName[r.income_source_id] || '',
    budgetName: (() => {
      const ls = txLines[r.id] || []
      if (ls.length === 0) return ''
      if (ls.length === 1) return budgetLabel[ls[0].budget_id] || t('overall')
      return `${t('split')} (${ls.length})`
    })(),
  })), [rows, lk.accountName, lk.categoryName, lk.sourceName, budgetLabel, txLines, t])

  const filtered = useMemo(() => {
    let out = enriched.filter((r) => {
      if (fType && r.type !== fType) return false
      if (fAccount && r.account_id !== fAccount && r.to_account_id !== fAccount) return false
      if (fCategory && r.category_id !== fCategory) return false
      if (fSource && r.income_source_id !== fSource) return false
      if (from && r.date < from) return false
      if (to && r.date > to) return false
      if (q) {
        const hay = `${r.description} ${r.vendor} ${r.accountName} ${r.categoryName} ${r.sourceName} ${r.receipt_number}`.toLowerCase()
        if (!hay.includes(q.toLowerCase())) return false
      }
      return true
    })
    const { col, dir } = sort
    out.sort((a, b) => {
      let av = a[col], bv = b[col]
      if (col === 'amount') { av = Number(av); bv = Number(bv) }
      if (av < bv) return dir === 'asc' ? -1 : 1
      if (av > bv) return dir === 'asc' ? 1 : -1
      return 0
    })
    return out
  }, [enriched, fType, fAccount, fCategory, fSource, from, to, q, sort])

  function toggleSort(col) {
    setSort((s) => (s.col === col ? { col, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'asc' }))
  }

  async function del(id) {
    if (!confirm(t('confirmDelete'))) return
    await supabase.from('transactions').delete().eq('id', id)
    toast.success(t('deleted')); load()
  }

  async function doReceiptsZip() {
    const withR = filtered.filter((r) => r.receipt_url && r.receipt_no)
    if (!withR.length) { toast.error(t('noReceipts')); return }
    setZipping(`0/${withR.length}`)
    try {
      const res = await downloadAllReceipts(filtered, supabase, { seasonName: active?.name },
        (done, total) => setZipping(`${done}/${total}`))
      if (res.failed) toast.error(`${res.count - res.failed}/${res.count}`)
      else toast.success(t('saved'))
    } catch (e) {
      toast.error(e.message || String(e))
    } finally { setZipping(null) }
  }

  function doExport() {
    exportTransactions(filtered, {
      seasonName: active?.name,
      periodLabel: from || to ? `${from || '…'}_${to || '…'}` : active?.name,
      accounts: balances.map((b) => ({ name: b.name, balance: b.balance })),
    })
  }

  const th = (col, label) => (
    <th onClick={() => toggleSort(col)}>{label}{sort.col === col ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : ''}</th>
  )

  return (
    <div>
      <div className="toolbar">
        <input className="grow" placeholder={t('search')} value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={fType} onChange={(e) => setFType(e.target.value)}>
          <option value="">{t('type')}: {t('all')}</option>
          {TX_TYPES.map((ty) => <option key={ty} value={ty}>{t(ty)}</option>)}
        </select>
        <select value={fAccount} onChange={(e) => setFAccount(e.target.value)}>
          <option value="">{t('account')}: {t('all')}</option>
          {lk.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <select value={fCategory} onChange={(e) => setFCategory(e.target.value)}>
          <option value="">{t('category')}: {t('all')}</option>
          {lk.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={fSource} onChange={(e) => setFSource(e.target.value)}>
          <option value="">{t('source')}: {t('all')}</option>
          {lk.sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} title={t('date')} />
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} title={t('date')} />
        <div className="spacer" />
        <button className="btn" onClick={doExport}>{t('export')}</button>
        <button className="btn" onClick={doReceiptsZip} disabled={!!zipping}>
          {zipping ? `${t('downloadReceipts')} ${zipping}` : t('downloadReceipts')}
        </button>
        {canTransact && <button className="btn btn-primary" onClick={() => { setEditing(null); setShowForm(true) }}>+ {t('add')}</button>}
      </div>

      <div className="panel table-wrap">
        <table className="data">
          <thead>
            <tr>
              {th('date', t('date'))}
              {th('type', t('type'))}
              {th('amount', t('amount'))}
              <th>{t('account')}</th>
              <th>{t('category')} / {t('source')}</th>
              <th>{t('description')}</th>
              <th>{t('receipt')}</th>
              {canTransact && <th>{t('actions')}</th>}
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id}>
                <td className="mono">{fmtDate(r.date)}</td>
                <td><span className={typePill[r.type]}>{t(r.type)}</span></td>
                <td className="num">{money(r.amount)}</td>
                <td>{r.type === 'transfer' ? `${r.accountName} → ${r.toAccountName}` : r.accountName || '—'}</td>
                <td>{r.type === 'expense' ? (r.budgetName || '—') : (r.categoryName || r.sourceName || '—')}</td>
                <td style={{ color: 'var(--text-dim)' }}>{r.description || r.vendor || '—'}</td>
                <td><Receipt path={r.receipt_url} number={r.receipt_number} /></td>
                {canTransact && (
                  <td>
                    <button className="btn btn-ghost btn-sm" onClick={() => { setEditing(r); setShowForm(true) }}>{t('edit')}</button>
                    <button className="btn btn-ghost btn-sm btn-danger" onClick={() => del(r.id)}>{t('delete')}</button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {loading ? <div className="empty">{t('loading')}</div> : (!filtered.length && <div className="empty">{t('noRows')}</div>)}
      </div>

      {showForm && (
        <TransactionForm
          editing={editing}
          seasonId={activeId}
          accounts={lk.accountsActive}
          categories={lk.categories}
          sources={lk.sourcesActive}
          budgets={budgetOptions}
          vendors={lk.vendorsActive}
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); toast.success(t('saved')); load() }}
        />
      )}
    </div>
  )
}

function Receipt({ path, number }) {
  const [url, setUrl] = useState(null)
  async function open() {
    if (url) { window.open(url, '_blank'); return }
    const { data } = await supabase.storage.from('receipts').createSignedUrl(path, 60)
    if (data?.signedUrl) { setUrl(data.signedUrl); window.open(data.signedUrl, '_blank') }
  }
  if (!path) return <span style={{ color: 'var(--text-faint)' }}>{number || '—'}</span>
  return <button className="btn btn-ghost btn-sm" onClick={open}>קבלה ↗</button>
}
