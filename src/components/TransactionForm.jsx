import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import DateField from './DateField'
import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'
import { useAuth } from '../context/AuthContext'
import { money } from '../lib/format'
import Modal from './Modal'
import CurrencyAmountInput from './CurrencyAmountInput'
import { TeamScopePicker } from './TeamScope'
import { resolveBudget } from '../domain/budgetResolver'
import { useLookups } from '../lib/useLookups'

const OTHER_TYPES = ['income', 'transfer', 'in_kind'] // expense handled separately (with lines)

export default function TransactionForm({ editing, initial, seasonId, accounts, categories, sources, budgets = [], vendors = [], onClose, onSaved, onPreview }) {
  const { t } = useI18n()
  const navigate = useNavigate()
  const { isMentor } = useAuth()
  const lk = useLookups()
  const seed = editing || initial || {}
  const knownVendor = seed.vendor && vendors.some((v) => v.name === seed.vendor)
  const [vendorMode, setVendorMode] = useState(() => (seed.vendor && !knownVendor ? 'other' : 'list'))
  const [fx, setFx] = useState(() => seed.fx_currency ? { currency: seed.fx_currency, amount: seed.fx_amount, rate: seed.fx_rate } : null)

  const [f, setF] = useState(() => ({
    type: seed.type || 'expense',
    date: seed.date || new Date().toISOString().slice(0, 10),
    amount: seed.amount || '',
    account_id: seed.account_id || '',
    to_account_id: seed.to_account_id || '',
    income_source_id: seed.income_source_id || '',
    category_id: seed.category_id || '',
    vendor: seed.vendor || '',
    description: seed.description || '',
    payer_name: seed.payer_name || '',
    // The list, seeded from whichever column the row actually has. The old
    // form showed only a file input, so an existing receipt looked like no
    // receipt at all — a file input cannot display a value it did not receive.
    receipt_urls: (seed.receipt_urls?.length ? seed.receipt_urls
      : (seed.receipt_url ? [seed.receipt_url] : [])),
    notes: seed.notes || '',
    team_scope: seed.team_scope || 'both',
  }))
  // expense lines: [{ budget_id, amount, description, shopping_item_id }]
  const [lines, setLines] = useState(() => seed.lines?.length ? seed.lines.map(normLine) : [emptyLine()])
  const [files, setFiles] = useState([])
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  // The header description defaults to the comma-joined line descriptions and
  // keeps tracking them as lines are added or renamed — until you type your
  // own, at which point it stops following and stays exactly as written. The
  // ↻ button puts it back on auto. Editing an existing row starts in manual
  // mode, so opening a saved purchase never silently rewrites its description.
  const [descMode, setDescMode] = useState(() => (seed.description ? 'manual' : 'auto'))

  // When editing an existing expense, load its lines (or seed one from the header for legacy rows)
  useEffect(() => {
    if (editing && editing.type === 'expense') {
      supabase.from('transaction_lines').select('*').eq('transaction_id', editing.id).then(({ data }) => {
        if (data?.length) setLines(data.map(normLine))
        else setLines([{ budget_id: editing.budget_id || '', amount: editing.amount || '', description: '', shopping_item_id: '' }])
      })
    }
  }, [editing])

  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const isExpense = f.type === 'expense'
  const showTo = f.type === 'transfer'
  const showSource = f.type === 'income' || f.type === 'in_kind'

  const autoDescription = useMemo(
    () => lines.map((l) => (l.description || '').trim()).filter(Boolean).join(', '),
    [lines])

  useEffect(() => {
    if (!isExpense || descMode !== 'auto') return
    setF((prev) => (prev.description === autoDescription ? prev : { ...prev, description: autoDescription }))
  }, [autoDescription, descMode, isExpense])

  // You choose WHAT it was for; which pot pays follows from that. The budget
  // is found by walking up the category tree to the nearest pot that covers
  // it, preferring one of the same program. Deriving it rather than offering
  // it as a second dropdown keeps the category report and the budget report
  // describing the same thing — an override would let them drift apart.
  const budgetFor = (categoryId, scope) =>
    resolveBudget(categoryId, scope, budgets, lk.parentOf)

  const setLineCategory = (i, categoryId) => setLines(lines.map((l, idx) => {
    if (idx !== i) return l
    const r = budgetFor(categoryId, l.team_scope)
    return { ...l, category_id: categoryId, budget_id: r.budget?.id || '' }
  }))

  // Changing a line's program can change which pot covers it.
  const setLineScope = (i, scope) => setLines(lines.map((l, idx) => {
    if (idx !== i) return l
    const r = budgetFor(l.category_id, scope)
    return { ...l, team_scope: scope, budget_id: r.budget?.id || '' }
  }))

  const total = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0)
  const setLine = (i, k, v) => setLines(lines.map((l, idx) => idx === i ? { ...l, [k]: v } : l))
  const addLine = () => setLines([...lines, emptyLine()])
  const removeLine = (i) => setLines(lines.length > 1 ? lines.filter((_, idx) => idx !== i) : lines)

  // Returns the full list: the ones already attached plus anything newly
  // picked. Uploads run together rather than one after another — a bank fee
  // slip should not wait on a 3 MB invoice.
  async function uploadReceipts() {
    if (!files.length) return f.receipt_urls
    const uploaded = await Promise.all(files.map(async (file) => {
      const path = `${seasonId}/${crypto.randomUUID()}-${file.name}`
      const up = await supabase.storage.from('receipts').upload(path, file)
      if (up.error) throw up.error
      return up.data.path
    }))
    return [...f.receipt_urls, ...uploaded]
  }

  // Hands the draft to the simulation through the URL, so it survives the
  // navigation without a shared store — and so the link can be sent to
  // someone else to look at. Deliberately does not save anything.
  function openInSimulation() {
    const first = lines[0] || {}
    const p = new URLSearchParams()
    p.set('amount', String(total))
    if (f.description) p.set('label', f.description)
    if (first.category_id) p.set('category', first.category_id)
    if (first.team_scope) p.set('scope', first.team_scope)
    if (f.account_id) p.set('account', f.account_id)
    navigate(`/simulation?${p.toString()}`)
  }

  async function saveExpense() {
    if (!f.account_id) { setErr(t('requiredField') + ': ' + t('account')); return }
    const clean = lines.filter((l) => Number(l.amount) > 0)
    if (!clean.length) { setErr(t('needOneLine')); return }
    setErr(''); setBusy(true)
    try {
      const receipt_urls = await uploadReceipts()
      const p_lines = clean.map((l) => ({
        budget_id: l.budget_id || null,
        amount: Number(l.amount),
        shopping_item_id: l.shopping_item_id || null,
        description: l.description || null,
        // The currency breadcrumb used to be dropped on the floor for expenses
        // — entered per line, never written anywhere. It is persisted now.
        fx_currency: l.fx?.currency || null,
        fx_amount: l.fx?.amount ? Number(l.fx.amount) : null,
        fx_rate: l.fx?.rate ? Number(l.fx.rate) : null,
        team_scope: l.team_scope || 'both',
        category_id: l.category_id || null,
      }))
      const { data, error } = await supabase.rpc('save_expense', {
        p_tx_id: editing?.id || null,
        p_season_id: seasonId,
        p_date: f.date,
        p_account_id: f.account_id,
        p_vendor: f.vendor || null,
        p_description: f.description || null,
        // Both are sent: the array is what the app uses, and receipt_url keeps
        // the first one so an older build — or the Excel backup, which reads
        // that column — still finds a receipt.
        p_receipt_url: receipt_urls[0] || null,
        p_receipt_urls: receipt_urls,
        p_lines,
        p_payer_name: f.payer_name || null,
        // null lets the database derive it from the lines: uniform lines set the
        // header, a mixed basket becomes 'shared'.
        p_team_scope: null,
        // The database decides regardless of what is sent — this only makes
        // the intent explicit and lets the button say the right thing.
        p_propose: !isMentor,
      })
      if (error) throw error
      onSaved({ id: data })
    } catch (e) { setErr(e.message || String(e)) } finally { setBusy(false) }
  }

  async function saveOther() {
    if (!(Number(f.amount) > 0) && f.type !== 'in_kind') { setErr(t('requiredField') + ': ' + t('amount')); return }
    if (f.type !== 'in_kind' && !f.account_id) { setErr(t('requiredField') + ': ' + (showTo ? t('fromAccount') : t('account'))); return }
    if (showTo && !f.to_account_id) { setErr(t('requiredField') + ': ' + t('toAccount')); return }
    if (showTo && f.account_id === f.to_account_id) { setErr(t('fromAccount') + ' ≠ ' + t('toAccount')); return }
    if (showSource && !f.income_source_id) { setErr(t('requiredField') + ': ' + t('source')); return }
    if (f.type === 'in_kind' && !f.category_id) { setErr(t('requiredField') + ': ' + t('category')); return }
    setErr(''); setBusy(true)
    try {
      const payload = {
        season_id: seasonId,
        type: f.type,
        date: f.date,
        amount: f.type === 'in_kind' ? 1 : Number(f.amount),
        account_id: f.type === 'in_kind' ? null : f.account_id,
        to_account_id: showTo ? f.to_account_id : null,
        income_source_id: showSource ? f.income_source_id : null,
        category_id: f.type === 'in_kind' ? (f.category_id || null) : null,
        description: f.description || null,
        payer_name: f.payer_name || null,
        notes: f.notes || null,
        team_scope: f.team_scope || 'both',
        fx_currency: fx?.currency || null,
        fx_amount: fx?.amount ? Number(fx.amount) : null,
        fx_rate: fx?.rate ? Number(fx.rate) : null,
      }
      const res = editing
        ? await supabase.from('transactions').update(payload).eq('id', editing.id).select().single()
        : await supabase.from('transactions').insert(payload).select().single()
      if (res.error) throw res.error
      onSaved(res.data)
    } catch (e) { setErr(e.message || String(e)) } finally { setBusy(false) }
  }

  const save = () => (isExpense ? saveExpense() : saveOther())

  return (
    <Modal
      wide={isExpense}
      title={editing ? t('editTransaction') : t('addTransaction')}
      onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>{t('cancel')}</button>
        {/* Try it before committing to it. Deliberately does NOT save: the
            point is to see what this purchase would do to the balances and the
            budgets first. Only offered once there is an amount to try. */}
        {total > 0 && (
          <button className="btn btn-ghost" onClick={openInSimulation}>{t('openInSimulation')}</button>
        )}
        <button className="btn btn-primary" onClick={save} disabled={busy}>
          {busy ? '…' : (isMentor ? t('save') : t('proposeExpense'))}
        </button>
      </>}
    >
      {!isMentor && (
        <div className="panel panel-pad" style={{
          borderColor: 'var(--orange)', background: 'rgba(255,145,0,.06)',
          marginBottom: 12, fontSize: 13,
        }}>{t('pendingHint')}</div>
      )}

      <div className="field">
        <label>{t('type')}</label>
        <div className="tabs" style={{ marginBottom: 0 }}>
          <button className={'tab' + (isExpense ? ' active' : '')} onClick={() => setF({ ...f, type: 'expense' })}>{t('expense')}</button>
          {OTHER_TYPES.map((ty) => (
            <button key={ty} className={'tab' + (f.type === ty ? ' active' : '')} onClick={() => setF({ ...f, type: ty })}>{t(ty)}</button>
          ))}
        </div>
      </div>

      {!isExpense && (
        <div className="field">
          <label>{t('teamScope')}</label>
          <TeamScopePicker value={f.team_scope} onChange={(v) => setF({ ...f, team_scope: v })} />
        </div>
      )}

      <div className="grid-2">
        <div className="field"><label>{t('date')}</label><DateField value={f.date} onChange={set('date')} /></div>
        {f.type !== 'in_kind' && !isExpense && (
          <div className="field"><label>{t('amount')} (₪)</label>
            <CurrencyAmountInput value={f.amount} onChange={(v) => setF({ ...f, amount: v })} fx={fx} onFxChange={setFx} placeholder={t('amount')} />
          </div>
        )}
      </div>

      {/* account (from) — for expense, income, transfer */}
      {f.type !== 'in_kind' && (
        <div className="field">
          <label>{showTo ? t('fromAccount') : t('account')}</label>
          <select value={f.account_id} onChange={set('account_id')}>
            <option value="">—</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
      )}
      {showTo && (
        <div className="field">
          <label>{t('toAccount')}</label>
          <select value={f.to_account_id} onChange={set('to_account_id')}>
            <option value="">—</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
      )}
      {showSource && (
        <div className="field">
          <label>{t('source')}</label>
          <select value={f.income_source_id} onChange={set('income_source_id')}>
            <option value="">—</option>
            {sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      )}
      {f.type === 'in_kind' && (
        <div className="field">
          <label>{t('category')}</label>
          <select value={f.category_id} onChange={set('category_id')}>
            <option value="">—</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      )}

      {/* EXPENSE: vendor + lines editor */}
      {isExpense && (
        <>
          <div className="field">
            <label>{t('vendor')}</label>
            {vendorMode === 'other' ? (
              <div style={{ display: 'flex', gap: 8 }}>
                <input value={f.vendor} onChange={set('vendor')} placeholder={t('vendor')} />
                <button className="btn btn-sm" onClick={() => { setVendorMode('list'); setF({ ...f, vendor: '' }) }}>↩</button>
              </div>
            ) : (
              <select value={f.vendor} onChange={(e) => {
                if (e.target.value === '__other__') { setVendorMode('other'); setF({ ...f, vendor: '' }) }
                else setF({ ...f, vendor: e.target.value })
              }}>
                <option value="">—</option>
                {vendors.map((v) => <option key={v.id} value={v.name}>{v.name}</option>)}
                <option value="__other__">{t('vendorOther')}</option>
              </select>
            )}
          </div>

          <div className="field">
            <label>{t('lines')}</label>
            {lines.map((l, i) => (
              <div key={i} className="line-row">
                <select value={l.category_id} onChange={(e) => setLineCategory(i, e.target.value)}>
                  <option value="">{t('uncategorized')}</option>
                  {lk.categoryTree.map((c) => (
                    <option key={c.id} value={c.id}>{c.path || c.name}</option>
                  ))}
                </select>
                <div>
                  <CurrencyAmountInput compact value={l.amount} onChange={(v) => setLine(i, 'amount', v)}
                    fx={l.fx} onFxChange={(fxVal) => setLine(i, 'fx', fxVal)} placeholder="₪" />
                </div>
                <select className="line-scope" value={l.team_scope || 'both'} title={t('lineScope')}
                  onChange={(e) => setLineScope(i, e.target.value)}>
                  <option value="both">{t('scope_both')}</option>
                  <option value="frc">{t('scope_frc')}</option>
                  <option value="ftc">{t('scope_ftc')}</option>
                </select>
                <input className="line-desc" placeholder={t('description')} value={l.description}
                  onChange={(e) => setLine(i, 'description', e.target.value)} />
                {/* Say which pot this lands in. Deriving it silently would be
                    the same trap as deriving it wrongly. */}
                <span className="line-paidfrom" style={{
                  gridColumn: '1 / -1', fontSize: 12, color: 'var(--text-faint)',
                  marginTop: -2,
                }}>
                  {(() => {
                    const r = budgetFor(l.category_id, l.team_scope)
                    if (!r.budget) return t('noBudgetCovers')
                    const via = budgets.find((b) => b.id === r.budget.id)
                    return `${t('paidFrom')}: ${via?.label || '—'}${r.exact ? '' : ' ↑'}`
                  })()}
                </span>
                <button className="btn btn-ghost btn-sm btn-danger" onClick={() => removeLine(i)}>✕</button>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
              <button className="btn btn-sm" onClick={addLine}>+ {t('addLine')}</button>
              <span className="mono" style={{ fontWeight: 700 }}>{t('total')}: {money(total)}</span>
            </div>
          </div>

          <div className="field">
            <label>{t('receipts')}</label>
            {/* Already attached — listed so editing a transaction shows what is
                on it. Previously the form had only a file input, which always
                renders empty, so an existing receipt looked like none. */}
            {f.receipt_urls.map((u, i) => (
              <div key={u} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
                <button type="button" className="btn btn-ghost btn-sm"
                  onClick={() => onPreview?.({ path: u })}>{t('preview')}</button>
                <span style={{ flex: 1, fontSize: 12, color: 'var(--text-dim)', overflowWrap: 'anywhere' }}>
                  {u.split('/').pop()}
                </span>
                <button type="button" className="btn btn-ghost btn-sm btn-danger"
                  onClick={() => setF({ ...f, receipt_urls: f.receipt_urls.filter((_, ix) => ix !== i) })}>✕</button>
              </div>
            ))}
            <input type="file" multiple onChange={(e) => setFiles([...(e.target.files || [])])} />
            {files.length > 0 && (
              <p style={{ fontSize: 12, color: 'var(--text-faint)', margin: '4px 0 0' }}>
                {t('willUpload').replace('{n}', files.length)}
              </p>
            )}
          </div>
        </>
      )}

      <div className="field">
        <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <span>{t('description')}</span>
          {isExpense && (descMode === 'auto'
            ? <span className="badge">{t('autoDescription')}</span>
            : <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDescMode('auto')}>↻ {t('autoDescription')}</button>)}
        </label>
        <input value={f.description}
          onChange={(e) => { if (isExpense) setDescMode('manual'); setF({ ...f, description: e.target.value }) }} />
        {isExpense && descMode === 'auto' && (
          <p style={{ color: 'var(--text-faint)', fontSize: 12, margin: '4px 0 0' }}>{t('autoDescriptionHint')}</p>
        )}
      </div>
      <div className="field"><label>{t('payer')}</label><input value={f.payer_name} onChange={set('payer_name')} placeholder={t('payerHint')} /></div>
      {!isExpense && <div className="field"><label>{t('notes')}</label><textarea rows="2" value={f.notes} onChange={set('notes')} /></div>}

      {err && <div className="err">{err}</div>}
    </Modal>
  )
}

const emptyLine = () => ({ budget_id: '', category_id: '', amount: '', description: '', shopping_item_id: '', fx: null, team_scope: 'both' })
const normLine = (l) => ({
  budget_id: l.budget_id || '',
  amount: l.amount ?? '',
  description: l.description || '',
  shopping_item_id: l.shopping_item_id || '',
  fx: l.fx_currency ? { currency: l.fx_currency, amount: l.fx_amount, rate: l.fx_rate } : null,
  team_scope: l.team_scope || 'both',
  category_id: l.category_id || '',
})
