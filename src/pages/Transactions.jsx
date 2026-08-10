import { useEffect, useMemo, useState } from 'react'
import DateField from '../components/DateField'
import { supabase, withTimeout } from '../lib/supabase'
import { useRefreshOnReturn } from '../lib/useRefreshOnReturn'
import { useAuth } from '../context/AuthContext'
import { useSeason } from '../context/SeasonContext'
import { useI18n } from '../lib/i18n'
import { useToast } from '../lib/toast'
import { useLookups } from '../lib/useLookups'
import { money, fmtDate, typePill, TX_TYPES } from '../lib/format'
import { exportTransactions, downloadAllReceipts } from '../lib/export'
import { catLabel } from '../context/LookupsContext'
import TransactionForm from '../components/TransactionForm'
import { useTeamScope } from '../context/TeamScopeContext'
import { TeamScopeBadge } from '../components/TeamScope'
import { attributableAmount } from '../lib/teamScope'
import { TX } from '../domain/constants'
import ReceiptPreview from '../components/ReceiptPreview'
import ApprovalQueue from '../components/ApprovalQueue'
import DetailPanel from '../components/DetailPanel'

export default function Transactions() {
  const { t } = useI18n()
  const { canTransact, canPropose, session, isParent, isMentor } = useAuth()
  const uid = session?.user?.id || (isParent ? 'guest' : null)
  const { activeId, active } = useSeason()
  const toast = useToast()
  const lk = useLookups()
  const ts = useTeamScope()
  const [rows, setRows] = useState([])
  const [budgets, setBudgets] = useState([])
  const [txLines, setTxLines] = useState({})
  const [loading, setLoading] = useState(true)
  const [zipping, setZipping] = useState(null)   // null | 'n/total'
  const [balances, setBalances] = useState([])
  const [editing, setEditing] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [preview, setPreview] = useState(null)   // { path, number }
  const [decidingId, setDecidingId] = useState(null)
  const [detail, setDetail] = useState(null)

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
    // Only show the loading state if we have nothing on screen yet. A refetch
    // triggered by returning to the tab should refresh quietly in the
    // background — it must never blank out data that's already displayed.
    if (rows.length === 0) setLoading(true)
    try {
      // All four queries in parallel — previously they ran one after another.
      const [tx, bal, bg, tl] = await withTimeout(Promise.all([
        supabase.from(isParent ? 'transactions_guest' : 'transactions_view').select('*').eq('season_id', activeId),
        supabase.from('account_balances').select('*'),
        supabase.from('budgets').select('*').eq('season_id', activeId),
        supabase.from('transaction_lines').select('transaction_id,budget_id,amount,team_scope,category_id,description,transactions!inner(season_id)').eq('transactions.season_id', activeId),
      ]))
      if (!tx.error) setRows(tx.data || [])      // keep prior data if a query fails
      if (!bal.error) setBalances(bal.data || [])
      if (!bg.error) setBudgets(bg.data || [])
      if (!tl.error) {
        const map = {}
        for (const l of tl.data || []) (map[l.transaction_id] = map[l.transaction_id] || []).push(l)
        setTxLines(map)
      }
    } catch (e) {
      if (e.message === 'timeout') toast.error(t('loadTimedOut'))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
  // Guests have no session by design, so data loading keys off "may view"
  // rather than "is signed in" — otherwise the two parent screens render empty.
    if (uid) load()
    else setLoading(false)   // not signed in yet — don't sit on a spinner forever
  }, [activeId, uid])

  // Re-fetch when the tab regains focus. This is what actually recovers from
  // a request that Chrome silently dropped while the tab was backgrounded —
  // without it, nothing would ever retry and the page could sit forever on
  // whatever it last managed to show. Safe because load() above only shows a
  // spinner when there's no data yet; a returning-user refresh is silent.
  useRefreshOnReturn(load, { enabled: !!(activeId && uid), deps: [activeId, uid] })

  const budgetOptions = useMemo(() => budgets.map((b) => ({
    id: b.id,
    category_id: b.category_id,
    team_scope: b.team_scope || 'both',
    // The program is part of the budget's identity now — two categories with
    // the same name can be different pots, so the label has to say which.
    label: (b.category_id ? (lk.categoryTree.find((c) => c.id === b.category_id)?.path || lk.categoryName[b.category_id] || '—') : t('overall'))
      + ((b.team_scope && b.team_scope !== 'both') ? ` · ${b.team_scope.toUpperCase()}` : ''),
  })), [budgets, lk.categoryTree, lk.categoryName, t])
  const budgetLabel = useMemo(() => Object.fromEntries(budgetOptions.map((b) => [b.id, b.label])), [budgetOptions])
  const budgetCat = useMemo(() => Object.fromEntries(budgets.map((b) => [b.id, b.category_id])), [budgets])

  // Pending rows are held apart from the ledger. They are not money yet, so
  // they must not sit among rows that are.
  const pendingRows = useMemo(
    () => rows.filter((r) => r.approval === 'pending'), [rows])
  const approvedRows = useMemo(
    () => rows.filter((r) => (r.approval || 'approved') !== 'pending'), [rows])

  async function decide(row, approve) {
    if (!approve && !confirm(t('confirmReject'))) return
    setDecidingId(row.id)
    const { error } = await supabase.rpc('decide_transaction', {
      p_tx_id: row.id, p_approve: approve, p_note: null,
    })
    setDecidingId(null)
    if (error) { toast.error(error.message); return }
    toast.success(t('saved'))
    load()
  }

  const enriched = useMemo(() => approvedRows.map((r) => ({
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
  })), [approvedRows, lk.accountName, lk.categoryName, lk.sourceName, budgetLabel, txLines, t])

  // Which category id(s) a transaction actually touches — an expense's
  // category lives on its lines' budgets (a split purchase can touch
  // several), not on the transaction row itself; in_kind is the one type
  // that does carry category_id directly.
  // A purchase can mix programs, so the row shows every marking its lines
  // actually carry rather than collapsing the lot to "shared".
  // txLines is ALREADY keyed by transaction id — no second index needed.
  // How much of this transaction belongs to the ticked programs. For a split
  // purchase under a single-program filter this is LESS than r.amount — the
  // row showed the full receipt while claiming to be a filtered view, which
  // overstates that program's spending by the other program's share.
  const scopeAmount = (r) => attributableAmount(r, txLines, ts)

  const scopesOf = (r) => {
    const own = txLines[r.id] || []
    const distinct = [...new Set(own.map((l) => l.team_scope || 'both'))]
    return distinct.length ? distinct : [r.team_scope || 'both']
  }

  const txCategoryIds = useMemo(() => {
    const m = {}
    for (const r of rows) {
      const ids = new Set()
      if (r.category_id) ids.add(r.category_id)
      for (const l of (txLines[r.id] || [])) {
        // The LINE's own category first. Reading only the budget's category
        // meant a line marked "מנועים" but paid from the "רובוט" pot was
        // filed under רובוט alone, so filtering by מנועים found nothing.
        // The budget's category stays as the fallback for rows created
        // before migration 21 gave lines a category of their own.
        const cid = l.category_id || budgetCat[l.budget_id]
        if (cid) ids.add(cid)
      }
      m[r.id] = ids
    }
    return m
  }, [rows, txLines, budgetCat])

  const filtered = useMemo(() => {
    let out = enriched.filter((r) => {
      if (!ts.matches(r.team_scope) && !scopesOf(r).some((sc) => ts.matches(sc))) return false
      if (fType && r.type !== fType) return false
      if (fAccount && r.account_id !== fAccount && r.to_account_id !== fAccount) return false
      if (fCategory) {
        // Picking a parent category (e.g. תחרויות) also matches its children
        // (אוכל/הסעות/מדים); picking a leaf matches only that leaf.
        const wanted = lk.descendantsOf(fCategory)
        const touched = txCategoryIds[r.id] || new Set()
        if (![...touched].some((cid) => wanted.has(cid))) return false
      }
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
  }, [enriched, fType, fAccount, fCategory, fSource, from, to, q, sort, txCategoryIds, lk, ts])

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

  // Totals of what is actually on screen, using in-view amounts — so the sum
  // under an FRC filter excludes the FTC half of a split purchase.
  const listTotals = useMemo(() => {
    let income = 0, expense = 0
    for (const r of filtered) {
      const v = scopeAmount(r)
      if (r.type === 'income') income += v
      else if (r.type === 'expense') expense += v
    }
    return { income, expense }
  }, [filtered, txLines, ts])   // eslint-disable-line react-hooks/exhaustive-deps

  function doExport() {
    // Ship the in-view share with each row so the workbook can hold both the
    // true receipt total and what this filtered view actually counted.
    exportTransactions(filtered.map((r) => ({ ...r, _scopeAmount: scopeAmount(r) })), {
      scope: { all: ts.all, frc: ts.frc, ftc: ts.ftc },
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
          {lk.categoryTree.map((c) => <option key={c.id} value={c.id}>{catLabel(c)}</option>)}
        </select>
        <select value={fSource} onChange={(e) => setFSource(e.target.value)}>
          <option value="">{t('source')}: {t('all')}</option>
          {lk.sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <DateField value={from} onChange={(e) => setFrom(e.target.value)} title={t('date')} />
        <DateField value={to} onChange={(e) => setTo(e.target.value)} title={t('date')} />
        <div className="spacer" />
        <button className="btn" onClick={doExport}>{t('export')}</button>
        <button className="btn" onClick={doReceiptsZip} disabled={!!zipping}>
          {zipping ? `${t('downloadReceipts')} ${zipping}` : t('downloadReceipts')}
        </button>
        {canPropose && (
          <button className="btn btn-primary" onClick={() => { setEditing(null); setShowForm(true) }}>
            + {isMentor ? t('add') : t('proposeExpense')}
          </button>
        )}
      </div>

      <div className="panel table-wrap">
        <table className="data">
          <thead>
            <tr>
              {th('date', t('date'))}
              {th('type', t('type'))}
              <th>{t('teamScope')}</th>
              {th('amount', t('amount'))}
              <th>{t('account')}</th>
              <th>{t('category')} / {t('source')}</th>
              <th>{t('description')}</th>
              {!isParent && <th>{t('payer')}</th>}
              {!isParent && <th>{t('receipt')}</th>}
              {(canTransact || canPropose) && <th>{t('actions')}</th>}
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id}>
                <td className="mono">{fmtDate(r.date)}</td>
                <td><span className={typePill[r.type]}>{t(r.type)}</span></td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {scopesOf(r).map((sc) => <TeamScopeBadge key={sc} scope={sc} />)}
                </td>
                <td className="num">
                  {/* An in-kind donation is equipment, not money. Its stored
                      amount is a placeholder 1, so printing it as ₪1.00 stated
                      a value that was never received. */}
                  {r.type === TX.IN_KIND ? <span style={{ color: 'var(--text-faint)' }}>—</span> : (() => {
                    const part = scopeAmount(r)
                    if (ts.all || part === Number(r.amount)) return money(r.amount)
                    return (<>
                      <b className="mono">{money(part)}</b>
                      <div style={{ color: 'var(--text-faint)', fontSize: 11, whiteSpace: 'nowrap' }}>
                        {t('outOfTotal').replace('{v}', money(r.amount))}
                      </div>
                    </>)
                  })()}
                </td>
                <td>{r.type === 'transfer' ? `${r.accountName} → ${r.toAccountName}` : r.accountName || '—'}</td>
                <td>{r.type === 'expense' ? (r.budgetName || '—') : (r.categoryName || r.sourceName || '—')}</td>
                <td className="desc-cell">
                  <button type="button" className="link-cell clamp-2"
                    title={r.description || r.vendor || ''}
                    onClick={() => setDetail(r)}>
                    {r.description || r.vendor || '—'}
                  </button>
                </td>
                {!isParent && <td style={{ color: 'var(--text-dim)' }}>{r.payer_display || '—'}</td>}
                {!isParent && (
                  <td>
                    {(() => {
                      const rs = r.receipt_urls?.length ? r.receipt_urls : (r.receipt_url ? [r.receipt_url] : [])
                      if (!rs.length) return '—'
                      return (
                        <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 2 }}>
                          {rs.map((u, i) => (
                            <Receipt key={u} path={u} allPaths={rs}
                              number={rs.length > 1 ? `${r.receipt_number || ''} ${i + 1}`.trim() : r.receipt_number}
                              onOpen={setPreview} />
                          ))}
                        </span>
                      )
                    })()}
                  </td>
                )}
                {(canTransact || canPropose) && (
                  <td>
                    {/* A mentor edits anything; anyone else only their own
                        proposal, and only while it is still pending — which is
                        also what the database allows. */}
                    {(canTransact || (r.approval === 'pending' && r.proposed_by === session?.user?.id)) && (
                      <button className="btn btn-ghost btn-sm" onClick={() => { setEditing(r); setShowForm(true) }}>{t('edit')}</button>
                    )}
                    {canTransact && (
                      <button className="btn btn-ghost btn-sm btn-danger" onClick={() => del(r.id)}>{t('delete')}</button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
          {filtered.length > 0 && (
            <tfoot>
              <tr style={{ borderTop: '2px solid var(--line-strong)', fontWeight: 700 }}>
                <td colSpan={2} style={{ color: 'var(--text-dim)' }}>
                  {t('shownTotal')} ({filtered.length})
                </td>
                <td className="num mono" style={{ color: 'var(--in)', whiteSpace: 'nowrap' }}>
                  + {money(listTotals.income)}
                </td>
                <td className="num mono" style={{ color: 'var(--out)', whiteSpace: 'nowrap' }}>
                  − {money(listTotals.expense)}
                </td>
                <td colSpan={20} />
              </tr>
            </tfoot>
          )}
        </table>
        {loading ? <div className="empty">{t('loading')}</div> : (!filtered.length && <div className="empty">{t('noRows')}</div>)}
      </div>

      {isMentor && <ApprovalQueue rows={pendingRows} onDecide={decide} busyId={decidingId} />}

      {detail && (
        <DetailPanel
          title={detail.description || detail.vendor || t('transaction')}
          onClose={() => setDetail(null)}
          canEdit={canTransact}
          onEdit={() => { setEditing(detail); setDetail(null); setShowForm(true) }}
          rows={[
            { label: t('date'), value: fmtDate(detail.date), mono: true },
            { label: t('type'), value: t(detail.type) },
            { label: t('teamScope'), value: <TeamScopeBadge scope={detail.team_scope} /> },
            { label: t('amount'), value: detail.type === TX.IN_KIND ? '—' : money(detail.amount), mono: true },
            { label: t('account'), value: detail.accountName },
            { label: t('vendor'), value: detail.vendor },
            { label: t('source'), value: detail.sourceName },
            {
              label: t('category'),
              // Single-line only. A split purchase gets a real table below, where
              // each category sits on its own row beside its own amount —
              // collapsing them here made the categories a separate list from the
              // figures they describe.
              value: (txLines[detail.id] || []).length > 1 ? null : detail.categoryLabel,
            },
            !isParent && { label: t('payer'), value: detail.payer_display },
            { label: t('notes'), value: detail.notes, style: { whiteSpace: 'pre-wrap' } },
          ]}
          footer={(txLines[detail.id] || []).length > 1 && (
            <>
              {/* A split purchase is only understandable line by line — the
                  header amount says nothing about which programs it covered. */}
              <div className="section-title">{t('lines')}</div>
              <table className="data">
                <thead><tr>
                  <th>{t('description')}</th>
                  <th>{t('category')}</th>
                  <th>{t('teamScope')}</th>
                  <th className="num">{t('amount')}</th>
                </tr></thead>
                <tbody>
                  {(txLines[detail.id] || []).map((l) => (
                    <tr key={l.id}>
                      <td>{l.description || '—'}</td>
                      {/* On the row itself: the question is "what was this line
                          for", and the answer belongs beside its own amount. */}
                      <td>{lk.categoryName[l.category_id] || budgetLabel(l.budget_id) || '—'}</td>
                      <td><TeamScopeBadge scope={l.team_scope} /></td>
                      <td className="num mono">{money(l.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        />
      )}

      {preview && <ReceiptPreview
          paths={preview.paths} path={preview.path} number={preview.number} onClose={() => setPreview(null)} />}

      {showForm && (
        <TransactionForm
          onPreview={setPreview}
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

// allPaths lets the preview page through every receipt on the transaction, so
// an invoice and its bank-fee slip are one dialog rather than two trips.
function Receipt({ path, number, onOpen, allPaths }) {
  if (!path) return <span style={{ color: 'var(--text-faint)' }}>{number || '—'}</span>
  return (
    <button className="btn btn-ghost btn-sm"
      onClick={() => onOpen({ path, paths: allPaths, number })}>
      {number || 'קבלה'} 🔍
    </button>
  )
}