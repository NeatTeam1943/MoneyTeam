import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'
import { money } from '../lib/format'
import Modal from './Modal'
import CurrencyAmountInput from './CurrencyAmountInput'

const OTHER_TYPES = ['income', 'transfer', 'in_kind'] // expense handled separately (with lines)

export default function TransactionForm({ editing, initial, seasonId, accounts, categories, sources, budgets = [], vendors = [], onClose, onSaved }) {
  const { t } = useI18n()
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
    receipt_url: seed.receipt_url || '',
    notes: seed.notes || '',
  }))
  // expense lines: [{ budget_id, amount, description, shopping_item_id }]
  const [lines, setLines] = useState(() => seed.lines?.length ? seed.lines.map(normLine) : [emptyLine()])
  const [file, setFile] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

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

  const total = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0)
  const setLine = (i, k, v) => setLines(lines.map((l, idx) => idx === i ? { ...l, [k]: v } : l))
  const addLine = () => setLines([...lines, emptyLine()])
  const removeLine = (i) => setLines(lines.length > 1 ? lines.filter((_, idx) => idx !== i) : lines)

  async function uploadReceipt() {
    if (!file) return f.receipt_url || null
    const path = `${seasonId}/${crypto.randomUUID()}-${file.name}`
    const up = await supabase.storage.from('receipts').upload(path, file)
    if (up.error) throw up.error
    return up.data.path
  }

  async function saveExpense() {
    if (!f.account_id) { setErr(t('requiredField') + ': ' + t('account')); return }
    const clean = lines.filter((l) => Number(l.amount) > 0)
    if (!clean.length) { setErr(t('needOneLine')); return }
    setErr(''); setBusy(true)
    try {
      const receipt_url = await uploadReceipt()
      const p_lines = clean.map((l) => ({
        budget_id: l.budget_id || null,
        amount: Number(l.amount),
        shopping_item_id: l.shopping_item_id || null,
        description: l.description || null,
      }))
      const { data, error } = await supabase.rpc('save_expense', {
        p_tx_id: editing?.id || null,
        p_season_id: seasonId,
        p_date: f.date,
        p_account_id: f.account_id,
        p_vendor: f.vendor || null,
        p_description: f.description || null,
        p_receipt_url: receipt_url,
        p_lines,
        p_payer_name: f.payer_name || null,
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
      title={editing ? t('editTransaction') : t('addTransaction')}
      onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>{t('cancel')}</button>
        <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? '…' : t('save')}</button>
      </>}
    >
      <div className="field">
        <label>{t('type')}</label>
        <div className="tabs" style={{ marginBottom: 0 }}>
          <button className={'tab' + (isExpense ? ' active' : '')} onClick={() => setF({ ...f, type: 'expense' })}>{t('expense')}</button>
          {OTHER_TYPES.map((ty) => (
            <button key={ty} className={'tab' + (f.type === ty ? ' active' : '')} onClick={() => setF({ ...f, type: ty })}>{t(ty)}</button>
          ))}
        </div>
      </div>

      <div className="grid-2">
        <div className="field"><label>{t('date')}</label><input type="date" value={f.date} onChange={set('date')} /></div>
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
              <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center' }}>
                <select value={l.budget_id} onChange={(e) => setLine(i, 'budget_id', e.target.value)} style={{ flex: 1.3 }}>
                  <option value="">{t('none')}</option>
                  {budgets.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
                </select>
                <div style={{ width: 140 }}>
                  <CurrencyAmountInput value={l.amount} onChange={(v) => setLine(i, 'amount', v)}
                    fx={l.fx} onFxChange={(fxVal) => setLine(i, 'fx', fxVal)} placeholder="₪" />
                </div>
                <input placeholder={t('description')} value={l.description} onChange={(e) => setLine(i, 'description', e.target.value)} style={{ flex: 1 }} />
                <button className="btn btn-ghost btn-sm btn-danger" onClick={() => removeLine(i)}>✕</button>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
              <button className="btn btn-sm" onClick={addLine}>+ {t('addLine')}</button>
              <span className="mono" style={{ fontWeight: 700 }}>{t('total')}: {money(total)}</span>
            </div>
          </div>

          <div className="field"><label>{t('receipt')} (קבלה)</label><input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} /></div>
        </>
      )}

      <div className="field"><label>{t('description')}</label><input value={f.description} onChange={set('description')} /></div>
      <div className="field"><label>{t('payer')}</label><input value={f.payer_name} onChange={set('payer_name')} placeholder={t('payerHint')} /></div>
      {!isExpense && <div className="field"><label>{t('notes')}</label><textarea rows="2" value={f.notes} onChange={set('notes')} /></div>}

      {err && <div className="err">{err}</div>}
    </Modal>
  )
}

const emptyLine = () => ({ budget_id: '', amount: '', description: '', shopping_item_id: '', fx: null })
const normLine = (l) => ({
  budget_id: l.budget_id || '',
  amount: l.amount ?? '',
  description: l.description || '',
  shopping_item_id: l.shopping_item_id || '',
  fx: null,   // fx breadcrumb is entry-time only, never persisted per line
})
