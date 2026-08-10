import { useEffect, useMemo, useState } from 'react'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts'
import { supabase, withTimeout } from '../lib/supabase'
import { useRefreshOnReturn } from '../lib/useRefreshOnReturn'
import { useAuth } from '../context/AuthContext'
import { useSeason } from '../context/SeasonContext'
import { useI18n } from '../lib/i18n'
import { useToast } from '../lib/toast'
import { useLookups } from '../lib/useLookups'
import { money, lineTotal, qtyOf } from '../lib/format'
import { exportShopping } from '../lib/export'
import ShoppingForm from '../components/ShoppingForm'
import TransactionForm from '../components/TransactionForm'
import { useTeamScope } from '../context/TeamScopeContext'
import { TeamScopeBadge } from '../components/TeamScope'
import DetailPanel from '../components/DetailPanel'
import { filterRows, sortRows } from '../domain/shopping'
import { splitByExclusivity } from '../lib/teamScope'
import { BUYABLE_STATUSES, DEFAULT_SHOPPING_STATUSES, OPEN_STATUSES } from '../domain/constants'

const STATUSES = ['pending_approval', 'approved', 'ordered', 'received', 'cancelled']
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

function Stat({ k, v, c }) {
  return (
    <div className="panel stat">
      <div className="k">{k}</div>
      <div className="v" style={{ color: c || 'var(--text)' }}>{v}</div>
    </div>
  )
}

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
  const [detail, setDetail] = useState(null)
  const [editing, setEditing] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [selected, setSelected] = useState(() => new Set())
  const [buyOpen, setBuyOpen] = useState(false)
  // Defaults to everything still in flight. A list you open to see what is
  // outstanding should not open full of items that already arrived.
  const [fStatuses, setFStatuses] = useState(() => [...DEFAULT_SHOPPING_STATUSES])
  const [fPriority, setFPriority] = useState('')
  const [fCategory, setFCategory] = useState('')
  const [fScopes, setFScopes] = useState([])
  const [fHasPrice, setFHasPrice] = useState('')

  const rankOf = useMemo(() => Object.fromEntries(lk.levels.map((l) => [l.id, l.rank])), [lk.levels])

  async function load() {
    if (!activeId) { setLoading(false); return }
    if (rows.length === 0) setLoading(true)   // only spinner when nothing is showing yet
    try {
      const [items, bg, tl] = await withTimeout(Promise.all([
        supabase.from('shopping_items').select('*').eq('season_id', activeId),
        supabase.from('budgets').select('*').eq('season_id', activeId),
        supabase.from('ledger_lines_full').select('amount,budget_id,team_scope,category_id,season_id,tx_team_scope').eq('season_id', activeId),
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
  useRefreshOnReturn(load, { enabled: !!(activeId && uid), deps: [activeId, uid] })

  // The FRC/FTC checklist is applied here, once — every chart, the table and
  // the export all read from `enriched`, so none of them can drift out of sync
  // with what the top bar says is being shown.
  const enriched = useMemo(() => rows.filter((r) => ts.matches(r.team_scope)).map((r) => ({
    ...r,
    categoryName: lk.categoryName[r.category_id] || '',
    priorityName: lk.levelName[r.priority_level_id] || '',
    // So free-text search can match "אושר" or "ממתין", which are on screen
    // but were not in any searchable field.
    statusLabel: t(r.status),
  })), [rows, lk.categoryName, lk.levelName, ts, t])

  // Expense lines carry their scope on the parent transaction.
  const scopedLines = useMemo(() => lines.filter((l) => ts.matches(l.tx_team_scope)), [lines, ts])

  // `then` is the tie-breaker: sorting by category alone left rows inside each
  // category in arrival order, which is where a long list stops being scannable.
  const [sort, setSort] = useState({ col: 'priority', dir: 'asc', then: 'name', thenDir: 'asc' })
  function toggleSort(col) {
    // Spread `s` first: the old version built a fresh object with only col and
    // dir, so every click on a column header silently discarded the secondary
    // sort. The dropdown looked ignored because the value was being deleted.
    setSort((s) => (s.col === col
      ? { ...s, col, dir: s.dir === 'asc' ? 'desc' : 'asc' }
      : { ...s, col, dir: 'asc' }))
  }
  const th = (col, label) => (
    <th onClick={() => toggleSort(col)} style={{ cursor: 'pointer' }}>{label}{sort.col === col ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : ''}</th>
  )

  // Filtering, searching and sorting live in src/domain/shopping.js — pure,
  // and pinned by scripts/golden-master-shopping-sim.mjs across every column,
  // both directions and several search terms.
  const filtered = useMemo(
    () => sortRows(
      filterRows(enriched, {
        search: q,
        statuses: fStatuses,
        priority: fPriority,
        // Picking a parent category is expected to include its children; the
        // subtree is expanded here so the filter itself needs no tree.
        categories: fCategory ? lk.descendantsOf(fCategory) : null,
        scopes: fScopes,
        hasPrice: fHasPrice,
      }),
      sort,
      { rankOf, statusLabel: t }),
    [enriched, fStatuses, fPriority, fCategory, fScopes, fHasPrice, q, rankOf, sort, t, lk])

  // "requested" = still wanted (not received / cancelled)
  const open = useMemo(() => enriched.filter((r) => BUYABLE_STATUSES.includes(r.status)), [enriched])

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
      // Line category first, budget category as the fallback for pre-21 rows
      // — same reason as the ledger filter: what a line was FOR is no longer
      // the same question as which pot paid for it.
      const catId = l.category_id || budgetCat[l.budget_id]
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
    category_id: b.category_id,
    team_scope: b.team_scope || 'both',
    // The program is part of the budget's identity now — two categories with
    // the same name can be different pots, so the label has to say which.
    label: (b.category_id ? (lk.categoryTree.find((c) => c.id === b.category_id)?.path || lk.categoryName[b.category_id] || '—') : t('overall'))
      + ((b.team_scope && b.team_scope !== 'both') ? ` · ${b.team_scope.toUpperCase()}` : ''),
  })), [budgets, lk.categoryTree, lk.categoryName, t])

  const selectedItems = useMemo(() => filtered.filter((r) => selected.has(r.id)), [filtered, selected])
  const buyableItems = useMemo(
    () => selectedItems.filter((r) => BUYABLE_STATUSES.includes(r.status)),
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

  // Outstanding requests on screen: the total, the split, and how many items.
  const openTotals = useMemo(() => {
    const open = enriched.filter((r) => OPEN_STATUSES.includes(r.status) && ts.matches(r.team_scope))
    return {
      total: open.reduce((s, r) => s + lineTotal(r), 0),
      count: open.length,
      split: splitByExclusivity(open, (r) => lineTotal(r), ts),
    }
  }, [enriched, ts])

  return (
    <div>
      {/* The list had no totals at all — you could see the rows and the charts
          but never what the outstanding requests came to. */}
      {openTotals.total > 0 && (
        <div className="stats" style={{ marginBottom: 18 }}>
          <Stat k={t('requestedOpen')} v={money(openTotals.total)} />
          {openTotals.split && (
            <>
              <Stat k={t('requestOnlyFor').replace('{p}', openTotals.split.program.toUpperCase())}
                v={money(openTotals.split.exclusive)} />
              <Stat k={t('requestShared')} v={money(openTotals.split.shared)} c="var(--text-dim)" />
            </>
          )}
          <Stat k={t('itemsOpen')} v={String(openTotals.count)} c="var(--text-dim)" />
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
        <div className="tabs" style={{ marginBottom: 0 }}>
          <button className={'tab' + (categoryGrouping === 'direct' ? ' active' : '')} onClick={() => setCategoryGrouping('direct')}>{t('directOnly')}</button>
          <button className={'tab' + (categoryGrouping === 'parent' ? ' active' : '')} onClick={() => setCategoryGrouping('parent')}>{t('groupByParent')}</button>
        </div>
      </div>
      <div className="charts">
        <div className="panel panel-pad">
          <div className="section-title" style={{ marginTop: 0 }}>{t('requestedAllByCategory')}</div>
          <div className="chart-box-short" style={{ direction: 'ltr' }}>
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
          <div className="chart-box-short" style={{ direction: 'ltr' }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={byStatus} margin={{ left: 8, right: 8 }}>
                <CartesianGrid stroke="var(--line)" vertical={false} />
                <XAxis dataKey="name" tick={axis} /><YAxis tick={axis} width={60} allowDecimals={false} />
                <Tooltip contentStyle={tip} formatter={(v) => money(v)} />
                <Bar dataKey="value" fill="#1100ff" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="panel panel-pad">
          <div className="section-title" style={{ marginTop: 0 }}>{t('actualByCategory')}</div>
          <div className="chart-box-short" style={{ direction: 'ltr' }}>
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
          <div className="chart-box-short" style={{ direction: 'ltr' }}>
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
        {/* One toggle per status rather than a dropdown: the useful question
            is "which of these am I looking at", and a single-select cannot
            express it. Each chip carries its own count so the effect of a
            click is visible before making it. */}
        <div className="status-chips">
          {STATUSES.map((st) => {
            const on = fStatuses.includes(st)
            const n = enriched.filter((r) => r.status === st).length
            return (
              <button key={st} type="button"
                className={'chip' + (on ? ' chip-on' : '')}
                aria-pressed={on}
                onClick={() => setFStatuses(on
                  ? fStatuses.filter((x) => x !== st)
                  : [...fStatuses, st])}>
                {t(st)} <span className="chip-count">{n}</span>
              </button>
            )
          })}
          <button type="button" className="btn btn-ghost btn-sm"
            onClick={() => setFStatuses(fStatuses.length === STATUSES.length ? [] : [...STATUSES])}>
            {fStatuses.length === STATUSES.length ? t('clearFilter') : t('all')}
          </button>
        </div>
        <select value={fPriority} onChange={(e) => setFPriority(e.target.value)}>
          <option value="">{t('priority')}: {t('all')}</option>
          {lk.levels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <select value={fCategory} onChange={(e) => setFCategory(e.target.value)}>
          <option value="">{t('category')}: {t('all')}</option>
          {lk.categoryTree.map((c) => (
            <option key={c.id} value={c.id}>{c.path || c.name}</option>
          ))}
        </select>
        <select value={fHasPrice} onChange={(e) => setFHasPrice(e.target.value)}>
          <option value="">{t('price')}: {t('all')}</option>
          <option value="yes">{t('withPrice')}</option>
          <option value="no">{t('withoutPrice')}</option>
        </select>
        {/* Tie-breaker for the primary sort: category alone left rows
            inside each category in arrival order. */}
        <select value={sort.then || ''} onChange={(e) => setSort({ ...sort, then: e.target.value || null })}>
          <option value="">{t('thenBy')}: —</option>
          <option value="name">{t('name')}</option>
          <option value="category">{t('category')}</option>
          <option value="priority">{t('priority')}</option>
          <option value="est_price">{t('unitPrice')}</option>
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

          <>

            <button className="btn btn-sm" onClick={clearSelection}>{t('selectNone')} ({selectedItems.length})</button>

            {/* What the selection comes to. Ticking rows to decide what to

                buy is pointless without the number the decision turns on. */}

            <span className="mono" style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>

              {t('selectedTotal')}: {money(selectedItems.reduce((sum, r) => sum + lineTotal(r), 0))}

            </span>

          </>

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
                    <td className="desc-cell">
                      <button type="button" className="link-cell clamp-2" title={r.name}
                        onClick={() => setDetail(r)}>{r.name}</button>
                    </td>
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
                    <td>
                      {(() => {
                        const links = r.urls?.length ? r.urls : (r.url ? [r.url] : [])
                        if (!links.length) return '—'
                        return (
                          <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 2 }}>
                            {links.map((u, i) => (
                              <a key={u + i} href={u} target="_blank" rel="noreferrer" style={{ whiteSpace: 'nowrap' }}>
                                {links.length > 1 ? `${t('openLink')} ${i + 1} ↗` : `${t('openLink')} ↗`}
                              </a>
                            ))}
                          </span>
                        )
                      })()}
                    </td>
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
      {detail && (
        <DetailPanel
          title={detail.name}
          onClose={() => setDetail(null)}
          canEdit={canAddShopping}
          onEdit={() => { setEditing(detail); setDetail(null); setShowForm(true) }}
          rows={[
            { label: t('teamScope'), value: <TeamScopeBadge scope={detail.team_scope} /> },
            // The full path, not just the leaf: "מנועים" alone does not say
            // which parent it sits under when several trees have similar names.
            { label: t('category'),
              value: lk.categoryTree.find((c) => c.id === detail.category_id)?.path
                || detail.categoryName || '—' },
            { label: t('sku'), value: detail.sku, mono: true },
            { label: t('vendor'), value: detail.vendor },
            { label: t('unitPrice'), value: detail.est_price != null ? money(detail.est_price) : null, mono: true },
            { label: t('unitCount'), value: qtyOf(detail), mono: true },
            { label: t('total'), value: money(lineTotal(detail)), mono: true },
            { label: t('priority'), value: detail.priorityName },
            { label: t('status'), value: t(detail.status) },
            {
              label: t('links'),
              value: (() => {
                const ls = detail.urls?.length ? detail.urls : (detail.url ? [detail.url] : [])
                if (!ls.length) return null
                return (
                  <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 3 }}>
                    {ls.map((u, i) => <a key={u + i} href={u} target="_blank" rel="noreferrer">{u}</a>)}
                  </span>
                )
              })(),
            },
            { label: t('notes'), value: detail.notes, style: { whiteSpace: 'pre-wrap' } },
          ]}
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