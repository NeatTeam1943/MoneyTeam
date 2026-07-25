import { useEffect, useMemo, useState } from 'react'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts'
import { supabase, withTimeout } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useSeason } from '../context/SeasonContext'
import { useI18n } from '../lib/i18n'
import { useToast } from '../lib/toast'
import { useLookups } from '../lib/useLookups'
import { money } from '../lib/format'
import Modal from '../components/Modal'
import { catLabel } from '../context/LookupsContext'

const axis = { fontSize: 12, fill: '#4c5570', fontFamily: 'Space Mono, monospace' }
const tip = { background: '#fff', border: '1px solid #c6cde0', borderRadius: 8, fontSize: 13, color: '#151a2b' }

export default function Budgets() {
  const { t } = useI18n()
  const { canBudget, session } = useAuth()
  const uid = session?.user?.id
  const { activeId } = useSeason()
  const toast = useToast()
  const lk = useLookups()
  const [budgets, setBudgets] = useState([])
  const [expenses, setExpenses] = useState([])
  const [shopping, setShopping] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)
  const [open, setOpen] = useState(false)

  async function load() {
    if (!activeId) { setLoading(false); return }
    if (budgets.length === 0) setLoading(true)   // only spinner when nothing is showing yet
    try {
      const [b, tl, sh] = await withTimeout(Promise.all([
        supabase.from('budgets').select('*').eq('season_id', activeId),
        supabase.from('transaction_lines').select('amount,budget_id,transactions!inner(season_id)').eq('transactions.season_id', activeId),
        supabase.from('shopping_items').select('est_price,quantity,category_id,status').eq('season_id', activeId),
      ]))
      if (!b.error) setBudgets(b.data || [])
      if (!tl.error) setExpenses(tl.data || []) // expense LINES (each charges a budget)
      if (!sh.error) setShopping(sh.data || [])
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

  // For each budget: spend + requested roll up over the category subtree.
  const budgetCat = useMemo(() => Object.fromEntries(budgets.map((b) => [b.id, b.category_id])), [budgets])

  const rows = useMemo(() => budgets.map((b) => {
    const isOverall = !b.category_id
    const set = isOverall ? null : lk.descendantsOf(b.category_id)
    const inScope = (cid) => isOverall || (cid && set.has(cid))
    // an expense's "category" is the category of the budget it was drawn from
    const spent = expenses.reduce((s, l) => s + (inScope(budgetCat[l.budget_id]) ? Number(l.amount) : 0), 0)
    const requested = shopping.reduce((s, r) => {
      if (r.status !== 'pending_approval' && r.status !== 'approved') return s
      return s + (inScope(r.category_id) ? (Number(r.est_price) || 0) * (r.quantity || 1) : 0)
    }, 0)
    return {
      ...b,
      label: isOverall ? t('overall') : (lk.categoryName[b.category_id] || t('uncategorized')),
      spent, requested,
      remaining: Number(b.amount) - spent,
      pct: b.amount > 0 ? Math.min(999, (spent / Number(b.amount)) * 100) : 0,
      childOver: (() => {
        if (isOverall) return false
        const childSum = budgets.reduce((sum, x) =>
          (x.category_id && x.category_id !== b.category_id && set.has(x.category_id))
            ? sum + Number(x.amount) : sum, 0)
        return childSum > Number(b.amount)
      })(),
    }
  }).sort((a, b) => (a.category_id ? 1 : 0) - (b.category_id ? 1 : 0) || b.amount - a.amount),
    [budgets, expenses, shopping, budgetCat, lk, t])

  const chartData = useMemo(() => rows.map((r) => ({ name: r.label, [t('spent')]: r.spent, [t('requested')]: r.requested })), [rows, t])

  async function del(id) {
    if (!confirm(t('confirmDelete'))) return
    await supabase.from('budgets').delete().eq('id', id)
    toast.success(t('deleted')); load()
  }

  const barColor = (pct) => (pct > 100 ? 'var(--danger)' : pct >= 80 ? 'var(--orange)' : 'var(--ok)')

  return (
    <div>
      {rows.length > 0 && (
        <div className="panel panel-pad" style={{ marginBottom: 18 }}>
          <div className="section-title" style={{ marginTop: 0 }}>{t('budgetVsRequested')}</div>
          <div style={{ height: 260, direction: 'ltr' }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ left: 8, right: 8 }}>
                <CartesianGrid stroke="#dde2ee" vertical={false} />
                <XAxis dataKey="name" tick={axis} /><YAxis tick={axis} width={64} />
                <Tooltip contentStyle={tip} formatter={(v) => money(v)} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey={t('spent')} fill="#ff9100" radius={[3, 3, 0, 0]} />
                <Bar dataKey={t('requested')} fill="#1100ff" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {canBudget && (
        <div className="toolbar">
          <div className="spacer" />
          <button className="btn btn-primary" onClick={() => { setEditing(null); setOpen(true) }}>+ {t('setBudget')}</button>
        </div>
      )}

      {loading ? (
        <div className="panel empty">{t('loading')}</div>
      ) : rows.length ? (
        <div className="grid-2">
          {rows.map((r) => (
            <div key={r.id} className="panel panel-pad" style={r.childOver ? { borderColor: 'var(--danger)' } : undefined}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
                <h3 style={{ fontSize: 16 }}>{r.label}</h3>
                <span className="mono" style={{ color: 'var(--text-dim)', fontSize: 13 }}>{Math.round(r.pct)}%</span>
              </div>
              {r.childOver && <div style={{ color: 'var(--danger)', fontSize: 12, fontWeight: 700, marginBottom: 8 }}>{t('childrenExceedParent')}</div>}
              <div className="bar-track"><div className="bar-fill" style={{ width: Math.min(100, r.pct) + '%', background: barColor(r.pct) }} /></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12, fontSize: 13 }}>
                <span><span style={{ color: 'var(--text-faint)' }}>{t('spent')} </span><b className="mono">{money(r.spent)}</b></span>
                <span><span style={{ color: 'var(--text-faint)' }}>{t('budget')} </span><b className="mono">{money(r.amount)}</b></span>
                <span style={{ color: r.remaining < 0 ? 'var(--danger)' : 'var(--ok)' }}>{t('remaining')} <b className="mono">{money(r.remaining)}</b></span>
              </div>
              {canBudget && (
                <div style={{ marginTop: 12, display: 'flex', gap: 6 }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => { setEditing(r); setOpen(true) }}>{t('edit')}</button>
                  <button className="btn btn-ghost btn-sm btn-danger" onClick={() => del(r.id)}>{t('delete')}</button>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="panel empty-cta">
          <p>{t('noBudgetsYet')}</p>
          {canBudget && <button className="btn btn-primary" onClick={() => { setEditing(null); setOpen(true) }}>+ {t('addFirst')}</button>}
        </div>
      )}

      {open && (
        <BudgetForm
          editing={editing} seasonId={activeId} categoryTree={lk.categoryTree} existing={budgets}
          onClose={() => setOpen(false)} onSaved={() => { setOpen(false); toast.success(t('saved')); load() }}
        />
      )}
    </div>
  )
}

function BudgetForm({ editing, seasonId, categoryTree, existing, onClose, onSaved }) {
  const { t } = useI18n()
  const [categoryId, setCategoryId] = useState(editing?.category_id || '')
  const [amount, setAmount] = useState(editing?.amount || '')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const taken = new Set(existing.filter((b) => b.id !== editing?.id).map((b) => b.category_id || '__overall__'))

  async function save() {
    if (!(Number(amount) >= 0)) { setErr(t('requiredField') + ': ' + t('amount')); return }
    setErr(''); setBusy(true)
    const payload = { season_id: seasonId, category_id: categoryId || null, amount: Number(amount) }
    const res = editing
      ? await supabase.from('budgets').update(payload).eq('id', editing.id)
      : await supabase.from('budgets').insert(payload)
    setBusy(false)
    if (res.error) { setErr(res.error.message); return }
    onSaved()
  }

  return (
    <Modal
      title={t('setBudget')} onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>{t('cancel')}</button>
        <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? '…' : t('save')}</button>
      </>}
    >
      <div className="field">
        <label>{t('category')}</label>
        <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} disabled={!!editing}>
          <option value="" disabled={taken.has('__overall__')}>{t('overall')}</option>
          {categoryTree.map((c) => (
            <option key={c.id} value={c.id} disabled={taken.has(c.id)}>{catLabel(c)}</option>
          ))}
        </select>
        {categoryTree.length === 0 && <p style={{ color: 'var(--text-faint)', fontSize: 12, marginTop: 6 }}>{t('noCategoriesHint')}</p>}
      </div>
      <div className="field">
        <label>{t('budget')} (₪)</label>
        <input type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </div>
      {err && <div className="err">{err}</div>}
    </Modal>
  )
}
