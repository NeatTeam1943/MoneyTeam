import { useEffect, useMemo, useState } from 'react'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts'
import { supabase, withTimeout } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useSeason } from '../context/SeasonContext'
import { useI18n } from '../lib/i18n'
import { useToast } from '../lib/toast'
import { useLookups } from '../lib/useLookups'
import { money, lineTotal } from '../lib/format'
import { exportShopping } from '../lib/export'
import ShoppingForm from '../components/ShoppingForm'
import TransactionForm from '../components/TransactionForm'
import { useTeamScope } from '../context/TeamScopeContext'
import { TeamScopeBadge } from '../components/TeamScope'

const STATUSES = ['pending_approval', 'approved', 'ordered', 'received', 'cancelled']
const axis = { fontSize: 12, fill: '#4c5570', fontFamily: 'Space Mono, monospace' }
const tip = { background: '#fff', border: '1px solid #c6cde0', borderRadius: 8, fontSize: 13, color: '#151a2b' }

export default function Shopping() {
  const { t } = useI18n()
  const { canAddShopping, canChangeStatus, canTransact, session } = useAuth()
  // Anyone who can act on a selection gets tick boxes — buying is not the only
  // reason to select rows any more.
  const canSelect = canTransact || canChangeStatus
  const uid = session?.user?.id
  const { activeId, active } = useSeason()
  const toast = useToast()
  const lk = useLookups()
  const ts = useTeamScope()
  const [rows, setRows] = useState([])
  const [budgets, setBudgets] = useState([])
  const [lines, setLines] = useState([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [selected, setSelected] = useState(() => new Set())
  const [buyOpen, setBuyOpen] = useState(false)
  const [fStatus, setFStatus] = useState('')
  const [fPriority, setFPriority] = useState('')

  const rankOf = useMemo(() => Object.fromEntries(lk.levels.map((l) => [l.id, l.rank])), [lk.levels])

  async function load() {
    if (!activeId) { setLoading(false); return }
    if (rows.length === 0) setLoading(true)   // only spinner when nothing is showing yet
    try {
      const [items, bg, tl] = await withTimeout(Promise.all([
        supabase.from('shopping_items').select('*').eq('season_id', activeId),
        supabase.from('budgets').select('*').eq('season_id', activeId),
        supabase.from('transaction_lines').select('amount,budget_id,transactions!inner(season_id,team_scope)').eq('transactions.season_id', activeId),
      ]))
      if (!items.error) setRows(items.data || [])
      if (!bg.error) setBudgets(bg.data || [])
      if (!tl.error) setLines(tl.data || [])
    } catch (e) {
      if (e.message === 'timeout') toast.error(t('loadTimedOut'))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    if (session?.user?.id) load()
    else setLoading(false)   // not signed in yet — don't sit on a spinner forever
  }, [activeId, uid])

  // Re-fetch on returning to the tab so a request Chrome dropped in the
  // background gets a fresh attempt — silent, since load() above won't show
  // a spinner while data is already on screen.
  useEffect(() => {
    const onFocus = () => { if (activeId && session?.user?.id) load() }
    const onVis = () => { if (!document.hidden) onFocus() }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVis)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [activeId, uid])

  // The FRC/FTC checklist is applied here, once — every chart, the table and
  // the export all read from `enriched`, so none of them can drift out of sync
  // with what the top bar says is being shown.
  const enriched = useMemo(() => rows.filter((r) => ts.matches(r.team_scope)).map((r) => ({
    ...r,
    categoryName: lk.categoryName[r.category_id] || '',
    priorityName: lk.levelName[r.priority_level_id] || '',
  })), [rows, lk.categoryName, lk.levelName, ts])

  // Expense lines carry their scope on the parent transaction.
  const scopedLines = useMemo(() => lines.filter((l) => ts.matches(l.transactions?.team_scope)), [lines, ts])

  const [sort, setSort] = useState({ col: 'priority', dir: 'asc' })
  function toggleSort(col) {
    setSort((s) => (s.col === col ? { col, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'asc' }))
  }
  const th = (col, label) => (
    <th onClick={() => toggleSort(col)} style={{ cursor: 'pointer' }}>{label}{sort.col === col ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : ''}</th>
  )

  const filtered = useMemo(() => {
    // Free-text search across everything you might actually remember about an
    // item — its name, part number, supplier, category or notes.
    const needle = q.trim().toLowerCase()
    const hit = (r) => !needle || [r.name, r.sku, r.vendor, r.categoryName, r.priorityName, r.notes, r.description]
      .some((v) => String(v || '').toLowerCase().includes(needle))
    const out = enriched.filter((r) => hit(r) && (!fStatus || r.status === fStatus) && (!fPriority || r.priority_level_id === fPriority))
    const { col, dir } = sort
    const mul = dir === 'asc' ? 1 : -1
    const val = (r) => {
      if (col === 'priority') return rankOf[r.priority_level_id] ?? 999
      if (col === 'est_price') return Number(r.est_price) || 0
      if (col === 'quantity') return Number(r.quantity) || 0
      if (col === 'category') return r.categoryName || ''
      if (col === 'name') return r.name || ''
      if (col === 'vendor') return r.vendor || ''
      if (col === 'status') return t(r.status) || ''
      return r[col] ?? ''
    }
    out.sort((a, b) => {
      const av = val(a), bv = val(b)
      if (av < bv) return -1 * mul
      if (av > bv) return 1 * mul
      return 0
    })
    return out
  }, [enriched, fStatus, fPriority, q, rankOf, sort, t])

  // "requested" = still wanted (not received / cancelled)
  const open = useMemo(() => enriched.filter((r) => r.status === 'pending_approval' || r.status === 'approved'), [enriched])

  // Same direct/parent toggle as the Dashboard's "by category" chart —
  // 'direct' never rolls a child (e.g. אוכל) into its parent (תחרויות);
  // 'parent' sums every category into its top-level ancestor.
  const [categoryGrouping, setCategoryGrouping] = useState('direct')
  const topAncestorName = useMemo(() => {
    const byId = Object.fromEntries(lk.categories.map((c) => [c.id, c]))
    const cache = {}
    return (id) => {
      if (!id) return null
      if (cache[id]) return cache[id]
      let cur = byId[id]
      if (!cur) return lk.categoryName[id] || null
      while (cur.parent_id && byId[cur.parent_id]) cur = byId[cur.parent_id]
      cache[id] = cur.name
      return cur.name
    }
  }, [lk.categories, lk.categoryName])
  const groupKey = (categoryId, fallbackName) =>
    (categoryGrouping === 'parent' ? topAncestorName(categoryId) : fallbackName) || t('overall')

  // ALL-TIME: every item ever requested, by category (every status included)
  const byCategoryAll = useMemo(() => {
    const m = {}
    for (const r of enriched) { const k = groupKey(r.category_id, r.categoryName); m[k] = (m[k] || 0) + lineTotal(r) }
    return Object.entries(m).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
  }, [enriched, categoryGrouping, topAncestorName])

  // STILL OUTSTANDING: only items not yet paid for — pending_approval / approved
  const byCategoryOpen = useMemo(() => {
    const m = {}
    for (const r of open) { const k = groupKey(r.category_id, r.categoryName); m[k] = (m[k] || 0) + lineTotal(r) }
    return Object.entries(m).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
  }, [open, categoryGrouping, topAncestorName])

  const byStatus = useMemo(() => {
    const m = {}
    for (const r of enriched) { const k = t(r.status); m[k] = (m[k] || 0) + lineTotal(r) }
    return Object.entries(m).map(([name, value]) => ({ name, value }))
  }, [enriched, t])

  // ACTUAL spend by category — from expense lines (real prices), not estimates
  const budgetCat = useMemo(() => Object.fromEntries(budgets.map((b) => [b.id, b.category_id])), [budgets])
  const actualByCategory = useMemo(() => {
    const m = {}
    for (const l of scopedLines) {
      const catId = budgetCat[l.budget_id]
      const k = groupKey(catId, lk.categoryName[catId])
      m[k] = (m[k] || 0) + Number(l.amount)
    }
    return Object.entries(m).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
  }, [scopedLines, budgetCat, lk.categoryName, t, categoryGrouping, topAncestorName])

  async function del(id) {
    if (!confirm(t('confirmDelete'))) return
    await supabase.from('shopping_items').delete().eq('id', id)
    toast.success(t('deleted')); load()
  }

  async function changeStatus(id, status) {
    const { error } = await supabase.from('shopping_items').update({ status }).eq('id', id)
    if (error) { toast.error(error.message); return }
    toast.success(t('saved')); load()
  }

  // Bulk status change. The DB trigger guard_shopping_status already refuses
  // this for anyone who is not a mentor, so the button is a convenience gate,
  // not the security boundary.
  async function bulkStatus(status) {
    const ids = selectedItems.map((r) => r.id)
    if (!ids.length) return
    if (!confirm(t('confirmBulkStatus').replace('{n}', ids.length).replace('{s}', t(status)))) return
    const { error } = await supabase.from('shopping_items').update({ status }).in('id', ids)
    if (error) { toast.error(error.message); return }
    toast.success(t('saved'))
    clearSelection()
    load()
  }

  function onBought() {
    // save_expense (RPC) already linked the items and set them to "ordered"
    setBuyOpen(false)
    setSelected(new Set())
    toast.success(t('saved'))
    load()
  }

  const budgetFor = (categoryId) => (budgets.find((b) => b.category_id === categoryId) || {}).id || ''
  const toggleSel = (id) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  function buyOne(item) { setSelected(new Set([item.id])); setBuyOpen(true) }

  // Selecting rows, then filtering them out of view, used to strand them:
  // the tick box was gone but the id stayed in the set, so the count kept
  // climbing with no way to clear it. Selection is now pruned to whatever is
  // actually on screen, and "clear" is always reachable.
  const selectAllFiltered = () => setSelected(new Set(filtered.map((r) => r.id)))
  const clearSelection = () => setSelected(new Set())

  const budgetOptions = useMemo(() => budgets.map((b) => ({
    id: b.id,
    team_scope: b.team_scope || 'both',
    // The program is part of the budget's identity now — two categories with
    // the same name can be different pots, so the label has to say which.
    label: (b.category_id ? (lk.categoryTree.find((c) => c.id === b.category_id)?.path || lk.categoryName[b.category_id] || '—') : t('overall'))
      + ((b.team_scope && b.team_scope !== 'both') ? ` · ${b.team_scope.toUpperCase()}` : ''),
  })), [budgets, lk.categoryTree, lk.categoryName, t])

  const selectedItems = useMemo(() => filtered.filter((r) => selected.has(r.id)), [filtered, selected])
  const buyableItems = useMemo(
    () => selectedItems.filter((r) => r.status === 'pending_approval' || r.status === 'approved'),
    [selectedItems])
  const allFilteredSelected = filtered.length > 0 && filtered.every((r) => selected.has(r.id))
  const buyPrefill = useMemo(() => {
    if (!buyableItems.length) return null
    const vendors = [...new Set(buyableItems.map((i) => i.vendor).filter(Boolean))]
    // If every item being bought carries the same marker, the purchase inherits
    // it; a mixed basket is a shared purchase.
    const scopes = [...new Set(buyableItems.map((i) => i.team_scope || 'both'))]
    return {
      type: 'expense',
      vendor: vendors.length === 1 ? vendors[0] : '',
      team_scope: scopes.length === 1 ? scopes[0] : 'both',
      lines: buyableItems.map((it) => ({
        budget_id: budgetFor(it.category_id),
        amount: it.est_price ? lineTotal(it) : '',
        shopping_item_id: it.id,
        description: it.name,
      })),
    }
  }, [buyableItems, budgets])

  function doExport() {
    exportShopping(filtered, { seasonName: active?.name, scope: { all: ts.all, frc: ts.frc, ftc: ts.ftc } })
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
        <div className="tabs" style={{ marginBottom: 0 }}>
          <button className={'tab' + (categoryGrouping === 'direct' ? ' active' : '')} onClick={() => setCategoryGrouping('direct')}>{t('directOnly')}</button>
          <button className={'tab' + (categoryGrouping === 'parent' ? ' active' : '')} onClick={() => setCategoryGrouping('parent')}>{t('groupByParent')}</button>
        </div>
      </div>
      <div className="charts">
        <div className="panel panel-pad">
          <div className="section-title" style={{ marginTop: 0 }}>{t('requestedAllByCategory')}</div>
          <div style={{ height: 220, direction: 'ltr' }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={byCategoryAll} layout="vertical" margin={{ left: 8, right: 16 }}>
                <XAxis type="number" tick={axis} allowDecimals={false} /><YAxis type="category" dataKey="name" tick={axis} width={130} interval={0} />
                <Tooltip contentStyle={tip} formatter={(v) => money(v)} />
                <Bar dataKey="value" fill="#ff9100" radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="panel panel-pad">
          <div className="section-title" style={{ marginTop: 0 }}>{t('requestedByStatus')}</div>
          <div style={{ height: 220, direction: 'ltr' }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={byStatus} margin={{ left: 8, right: 8 }}>
                <CartesianGrid stroke="#dde2ee" vertical={false} />
                <XAxis dataKey="name" tick={axis} /><YAxis tick={axis} width={60} allowDecimals={false} />
                <Tooltip contentStyle={tip} formatter={(v) => money(v)} />
                <Bar dataKey="value" fill="#1100ff" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="panel panel-pad">
          <div className="section-title" style={{ marginTop: 0 }}>{t('actualByCategory')}</div>
          <div style={{ height: 220, direction: 'ltr' }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={actualByCategory} layout="vertical" margin={{ left: 8, right: 16 }}>
                <XAxis type="number" tick={axis} allowDecimals={false} /><YAxis type="category" dataKey="name" tick={axis} width={130} interval={0} />
                <Tooltip contentStyle={tip} formatter={(v) => money(v)} />
                <Bar dataKey="value" fill="#12a150" radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="panel panel-pad">
          <div className="section-title" style={{ marginTop: 0 }}>{t('requestedByCategory')}</div>
          <div style={{ height: 220, direction: 'ltr' }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={byCategoryOpen} layout="vertical" margin={{ left: 8, right: 16 }}>
                <XAxis type="number" tick={axis} allowDecimals={false} /><YAxis type="category" dataKey="name" tick={axis} width={130} interval={0} />
                <Tooltip contentStyle={tip} formatter={(v) => money(v)} />
                <Bar dataKey="value" fill="#e0384c" radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="toolbar" style={{ marginTop: 18 }}>
        <select value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
          <option value="">{t('status')}: {t('all')}</option>
          {STATUSES.map((s) => <option key={s} value={s}>{t(s)}</option>)}
        </select>
        <select value={fPriority} onChange={(e) => setFPriority(e.target.value)}>
          <option value="">{t('priority')}: {t('all')}</option>
          {lk.levels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <div className="spacer" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('searchShopping')}
          style={{ flex: '1 1 14rem', minWidth: '10rem' }} />
        {q && <button className="btn btn-ghost btn-sm" onClick={() => setQ('')}>✕</button>}
        {canSelect && (
          <button className="btn btn-sm" onClick={allFilteredSelected ? clearSelection : selectAllFiltered}>
            {allFilteredSelected ? t('selectNone') : t('selectAllFiltered')}
          </button>
        )}
        {canSelect && selectedItems.length > 0 && (
          <button className="btn btn-sm" onClick={clearSelection}>{t('selectNone')} ({selectedItems.length})</button>
        )}
        {canChangeStatus && selectedItems.length > 0 && (
          <select value="" onChange={(e) => { if (e.target.value) bulkStatus(e.target.value) }}>
            <option value="">{t('bulkSetStatus')} ({selectedItems.length})</option>
            {STATUSES.map((st) => <option key={st} value={st}>{t(st)}</option>)}
          </select>
        )}
        {canTransact && buyableItems.length > 0 && <button className="btn btn-primary" onClick={() => setBuyOpen(true)}>{t('buySelected')} ({buyableItems.length})</button>}
        <button className="btn" onClick={doExport}>{t('exportShopping')}</button>
        {canAddShopping && <button className="btn btn-primary" onClick={() => { setEditing(null); setShowForm(true) }}>+ {t('add')}</button>}
      </div>

      {loading ? (
        <div className="panel empty">{t('loading')}</div>
      ) : filtered.length ? (
        <div className="panel table-wrap">
          <table className="data">
            <thead>
              <tr>
                {canSelect && <th><input type="checkbox" style={{ width: 'auto' }}
                  checked={allFilteredSelected}
                  onChange={() => (allFilteredSelected ? clearSelection() : selectAllFiltered())}
                  title={t('selectAllFiltered')} /></th>}
                {th('priority', t('priority'))}{th('name', t('name'))}<th>{t('teamScope')}</th><th>{t('sku')}</th>{th('category', t('category'))}
                {th('vendor', t('vendor'))}{th('est_price', t('estPrice'))}{th('quantity', t('quantity'))}{th('status', t('status'))}
                <th>{t('url')}</th>{(canAddShopping || canTransact) && <th>{t('actions')}</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const lvl = lk.levels.find((l) => l.id === r.priority_level_id)
                const done = r.status === 'received' || r.status === 'cancelled'
                const canBuy = canTransact && (r.status === 'pending_approval' || r.status === 'approved')
                return (
                  <tr key={r.id} style={done ? { opacity: 0.5, background: 'var(--panel-2)' } : undefined}>
                    {canSelect && <td><input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleSel(r.id)} style={{ width: 'auto' }} title={canBuy ? '' : t('notBuyable')} /></td>}
                    <td>{lvl ? <span className="pill" style={{ background: (lvl.color || '#8a8aa0') + '22', color: lvl.color || '#5b6472' }}>{lvl.name}</span> : '—'}</td>
                    <td>{r.name}</td>
                    <td><TeamScopeBadge scope={r.team_scope} /></td>
                    <td className="mono" style={{ color: 'var(--text-dim)' }}>{r.sku || '—'}</td>
                    <td>{r.categoryName || '—'}</td>
                    <td>{r.vendor || '—'}</td>
                    <td className="num">{r.est_price != null ? money(r.est_price) : '—'}</td>
                    <td className="num">{r.quantity}</td>
                    <td>
                      {canChangeStatus ? (
                        <select value={r.status} onChange={(e) => changeStatus(r.id, e.target.value)} style={{ width: 'auto', padding: '4px 8px', fontSize: 13 }}>
                          {STATUSES.map((s) => <option key={s} value={s}>{t(s)}</option>)}
                        </select>
                      ) : <span className="badge">{t(r.status)}</span>}
                    </td>
                    <td>{r.url ? <a href={r.url} target="_blank" rel="noreferrer">{t('openLink')} ↗</a> : '—'}</td>
                    {(canAddShopping || canTransact) && (
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {canBuy && <button className="btn btn-sm" onClick={() => buyOne(r)}>{t('buy')}</button>}
                        {canAddShopping && <button className="btn btn-ghost btn-sm" onClick={() => { setEditing(r); setShowForm(true) }}>{t('edit')}</button>}
                        {canTransact && <button className="btn btn-ghost btn-sm btn-danger" onClick={() => del(r.id)}>{t('delete')}</button>}
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="panel empty-cta">
          <p>{t('noItemsYet')}</p>
          {canAddShopping && <button className="btn btn-primary" onClick={() => { setEditing(null); setShowForm(true) }}>+ {t('addFirst')}</button>}
        </div>
      )}

      {buyOpen && buyPrefill && (
        <TransactionForm
          initial={buyPrefill} seasonId={activeId}
          accounts={lk.accountsActive} categories={lk.categories} sources={lk.sourcesActive} budgets={budgetOptions} vendors={lk.vendorsActive}
          onClose={() => setBuyOpen(false)} onSaved={onBought}
        />
      )}
      {showForm && (
        <ShoppingForm
          editing={editing} seasonId={activeId}
          categoryTree={lk.categoryTree} vendorsActive={lk.vendorsActive} levels={lk.levels} templates={lk.templatesActive}
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); toast.success(t('saved')); load() }}
        />
      )}
    </div>
  )
}