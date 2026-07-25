import { useEffect, useMemo, useState } from 'react'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useSeason } from '../context/SeasonContext'
import { useI18n } from '../lib/i18n'
import { useToast } from '../lib/toast'
import { useLookups } from '../lib/useLookups'
import { money } from '../lib/format'
import { exportShopping } from '../lib/export'
import ShoppingForm from '../components/ShoppingForm'
import TransactionForm from '../components/TransactionForm'

const STATUSES = ['pending_approval', 'approved', 'ordered', 'received', 'cancelled']
const axis = { fontSize: 12, fill: '#4c5570', fontFamily: 'Space Mono, monospace' }
const tip = { background: '#fff', border: '1px solid #c6cde0', borderRadius: 8, fontSize: 13, color: '#151a2b' }

export default function Shopping() {
  const { t } = useI18n()
  const { canAddShopping, canChangeStatus, canTransact, session } = useAuth()
  const uid = session?.user?.id
  const { activeId, active } = useSeason()
  const toast = useToast()
  const lk = useLookups()
  const [rows, setRows] = useState([])
  const [budgets, setBudgets] = useState([])
  const [lines, setLines] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [selected, setSelected] = useState(() => new Set())
  const [buyOpen, setBuyOpen] = useState(false)
  const [fStatus, setFStatus] = useState('')
  const [fPriority, setFPriority] = useState('')

  const rankOf = useMemo(() => Object.fromEntries(lk.levels.map((l) => [l.id, l.rank])), [lk.levels])

  async function load() {
    if (!activeId) { setLoading(false); return }
    setLoading(true)
    try {
      const [items, bg, tl] = await withTimeout(Promise.all([
        supabase.from('shopping_items').select('*').eq('season_id', activeId),
        supabase.from('budgets').select('*').eq('season_id', activeId),
        supabase.from('transaction_lines').select('amount,budget_id,transactions!inner(season_id)').eq('transactions.season_id', activeId),
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

  const enriched = useMemo(() => rows.map((r) => ({
    ...r,
    categoryName: lk.categoryName[r.category_id] || '',
    priorityName: lk.levelName[r.priority_level_id] || '',
  })), [rows, lk.categoryName, lk.levelName])

  const filtered = useMemo(() => enriched
    .filter((r) => (!fStatus || r.status === fStatus) && (!fPriority || r.priority_level_id === fPriority))
    .sort((a, b) => (rankOf[a.priority_level_id] ?? 999) - (rankOf[b.priority_level_id] ?? 999)),
    [enriched, fStatus, fPriority, rankOf])

  // "requested" = still wanted (not received / cancelled)
  const open = useMemo(() => enriched.filter((r) => r.status === 'pending_approval' || r.status === 'approved'), [enriched])

  // ALL-TIME: every item ever requested, by category (every status included)
  const byCategoryAll = useMemo(() => {
    const m = {}
    for (const r of enriched) { const k = r.categoryName || '—'; m[k] = (m[k] || 0) + (Number(r.est_price) || 0) * (r.quantity || 1) }
    return Object.entries(m).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
  }, [enriched])

  // STILL OUTSTANDING: only items not yet paid for — pending_approval / approved
  const byCategoryOpen = useMemo(() => {
    const m = {}
    for (const r of open) { const k = r.categoryName || '—'; m[k] = (m[k] || 0) + (Number(r.est_price) || 0) * (r.quantity || 1) }
    return Object.entries(m).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
  }, [open])

  const byStatus = useMemo(() => {
    const m = {}
    for (const r of enriched) { const k = t(r.status); m[k] = (m[k] || 0) + (Number(r.est_price) || 0) * (r.quantity || 1) }
    return Object.entries(m).map(([name, value]) => ({ name, value }))
  }, [enriched, t])

  // ACTUAL spend by category — from expense lines (real prices), not estimates
  const budgetCat = useMemo(() => Object.fromEntries(budgets.map((b) => [b.id, b.category_id])), [budgets])
  const actualByCategory = useMemo(() => {
    const m = {}
    for (const l of lines) { const k = lk.categoryName[budgetCat[l.budget_id]] || t('overall'); m[k] = (m[k] || 0) + Number(l.amount) }
    return Object.entries(m).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
  }, [lines, budgetCat, lk.categoryName, t])

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

  const budgetOptions = useMemo(() => budgets.map((b) => ({
    id: b.id,
    label: b.category_id ? (lk.categoryTree.find((c) => c.id === b.category_id)?.path || lk.categoryName[b.category_id] || '—') : t('overall'),
  })), [budgets, lk.categoryTree, lk.categoryName, t])

  const selectedItems = useMemo(() => enriched.filter((r) => selected.has(r.id)), [enriched, selected])
  const buyPrefill = useMemo(() => {
    if (!selectedItems.length) return null
    const vendors = [...new Set(selectedItems.map((i) => i.vendor).filter(Boolean))]
    return {
      type: 'expense',
      vendor: vendors.length === 1 ? vendors[0] : '',
      lines: selectedItems.map((it) => ({
        budget_id: budgetFor(it.category_id),
        amount: it.est_price ? Number(it.est_price) * (it.quantity || 1) : '',
        shopping_item_id: it.id,
        description: it.name,
      })),
    }
  }, [selectedItems, budgets])

  function doExport() {
    exportShopping(filtered, { seasonName: active?.name })
  }

  return (
    <div>
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
        {canTransact && selected.size > 0 && <button className="btn btn-primary" onClick={() => setBuyOpen(true)}>{t('buySelected')} ({selected.size})</button>}
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
                {canTransact && <th></th>}
                <th>{t('priority')}</th><th>{t('name')}</th><th>{t('sku')}</th><th>{t('category')}</th>
                <th>{t('vendor')}</th><th>{t('estPrice')}</th><th>{t('quantity')}</th><th>{t('status')}</th>
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
                    {canTransact && <td>{canBuy && <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleSel(r.id)} style={{ width: 'auto' }} />}</td>}
                    <td>{lvl ? <span className="pill" style={{ background: (lvl.color || '#8a8aa0') + '22', color: lvl.color || '#5b6472' }}>{lvl.name}</span> : '—'}</td>
                    <td>{r.name}</td>
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
