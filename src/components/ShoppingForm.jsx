import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'
import { money } from '../lib/format'
import { lineTotalOf } from '../domain/money'
import { useAuth } from '../context/AuthContext'
import Modal from './Modal'
import { catLabel } from '../context/LookupsContext'
import { TeamScopePicker } from './TeamScope'

const STATUSES = ['pending_approval', 'approved', 'ordered', 'received', 'cancelled']

export default function ShoppingForm({ editing, seasonId, categoryTree, vendorsActive, levels, templates = [], onClose, onSaved }) {
  const { t } = useI18n()
  const { isMentor } = useAuth()

  const knownVendor = editing?.vendor && vendorsActive.some((v) => v.name === editing.vendor)
  const [vendorMode, setVendorMode] = useState(() => (editing?.vendor && !knownVendor ? 'other' : 'list'))

  const [f, setF] = useState(() => ({
    name: editing?.name || '',
    urls: (editing?.urls?.length ? editing.urls : (editing?.url ? [editing.url] : [''])),
    sku: editing?.sku || '',
    category_id: editing?.category_id || '',
    vendor: editing?.vendor || '',
    est_price: editing?.est_price || '',
    quantity: editing?.quantity ?? 1,
    priority_level_id: editing?.priority_level_id || '',
    status: editing?.status || 'pending_approval',
    notes: editing?.notes || '',
    template_id: editing?.template_id || '',
    team_scope: editing?.team_scope || 'both',
  }))
  const [spec, setSpec] = useState(() => editing?.spec || {})
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })

  const template = templates.find((tp) => tp.id === f.template_id)
  // Fields saved before typed fields existed have no `type` — read them as text.
  const tfields = (template?.fields || []).map((fld) => ({ ...fld, type: fld.type || 'text' }))

  // A multiselect answer is an array, everything else a scalar; both need the
  // same "did they actually answer" test and the same display form.
  const isBlank = (v) => (Array.isArray(v) ? v.length === 0 : !String(v ?? '').trim())
  const showVal = (v) => (Array.isArray(v) ? v.join(', ') : String(v ?? '').trim())
  const toggleMulti = (label, opt) => {
    const cur = Array.isArray(spec[label]) ? spec[label] : []
    setSpec({ ...spec, [label]: cur.includes(opt) ? cur.filter((x) => x !== opt) : [...cur, opt] })
  }

  async function save() {
    if (!f.name.trim()) { setErr(t('requiredField') + ': ' + t('name')); return }
    if (!f.sku.trim()) { setErr(t('requiredField') + ': ' + t('sku')); return }
    if (!f.category_id) { setErr(t('requiredField') + ': ' + t('category')); return }
    // required template fields
    for (const fld of tfields) {
      if (fld.required && isBlank(spec[fld.label])) { setErr(t('requiredField') + ': ' + fld.label); return }
    }
    setErr(''); setBusy(true)

    // compose the template answers into the description, keep the structured spec too
    const composed = tfields
      .map((fld) => (isBlank(spec[fld.label]) ? '' : `${fld.label}: ${showVal(spec[fld.label])}`))
      .filter(Boolean).join(' | ')
    const payload = {
      season_id: seasonId,
      name: f.name.trim(),
      // The trigger strips blanks and duplicates and keeps `url` in step, so
      // the form can send the list as typed.
      urls: (f.urls || []).map((u) => u.trim()).filter(Boolean),
      sku: f.sku.trim(),
      category_id: f.category_id,
      vendor: f.vendor || null,
      est_price: f.est_price === '' ? null : Number(f.est_price),
      // An EMPTY box means "I did not say", which is 1 — the same default a new
      // row starts with. An explicit 0 is a real answer and must survive: the
      // 2027 list has five deliberate zero-quantity rows. `Number('') || 0`
      // collapsed both cases to 0.
      quantity: String(f.quantity).trim() === '' ? 1 : Math.max(0, Number(f.quantity) || 0),
      priority_level_id: f.priority_level_id || null,
      notes: f.notes || null,
      template_id: f.template_id || null,
      team_scope: f.team_scope || 'both',
      spec: template ? spec : null,
      description: template ? composed : (f.notes || null),
    }
    if (isMentor) payload.status = f.status
    else if (!editing) payload.status = 'pending_approval'

    const res = editing
      ? await supabase.from('shopping_items').update(payload).eq('id', editing.id)
      : await supabase.from('shopping_items').insert(payload)
    setBusy(false)
    if (res.error) { setErr(res.error.message); return }
    onSaved()
  }

  return (
    <Modal
      title={editing ? t('editItem') : t('addItem')}
      onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>{t('cancel')}</button>
        <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? '…' : t('save')}</button>
      </>}
    >
      {templates.length > 0 && (
        <div className="field">
          <label>{t('template')}</label>
          <select value={f.template_id} onChange={(e) => { setF({ ...f, template_id: e.target.value }); setSpec({}) }}>
            <option value="">{t('none')}</option>
            {templates.map((tp) => <option key={tp.id} value={tp.id}>{tp.name}</option>)}
          </select>
        </div>
      )}

      <div className="field">
        <label>{t('teamScope')}</label>
        <TeamScopePicker value={f.team_scope} onChange={(v) => setF({ ...f, team_scope: v })} />
      </div>

      <div className="field"><label>{t('name')} *</label><input value={f.name} onChange={set('name')} /></div>
      <div className="field">
        <label>{t('links')}</label>
        {(f.urls.length ? f.urls : ['']).map((u, i) => (
          <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
            <input value={u} placeholder="https://" style={{ flex: 1 }}
              onChange={(e) => setF({ ...f, urls: f.urls.map((x, idx) => (idx === i ? e.target.value : x)) })} />
            {f.urls.length > 1 && (
              <button type="button" className="btn btn-ghost btn-sm btn-danger"
                onClick={() => setF({ ...f, urls: f.urls.filter((_, idx) => idx !== i) })}>✕</button>
            )}
          </div>
        ))}
        <button type="button" className="btn btn-sm"
          onClick={() => setF({ ...f, urls: [...f.urls, ''] })}>+ {t('addLink')}</button>
      </div>
      <div className="grid-2">
        <div className="field"><label>{t('sku')} (מק״ט) *</label><input value={f.sku} onChange={set('sku')} /></div>
        <div className="field">
          <label>{t('category')} *</label>
          <select value={f.category_id} onChange={set('category_id')}>
            <option value="">—</option>
            {categoryTree.map((c) => <option key={c.id} value={c.id}>{catLabel(c)}</option>)}
          </select>
        </div>
      </div>

      {/* template-defined required fields */}
      {tfields.length > 0 && (
        <div className="field" style={{ border: '1px solid var(--line-strong)', borderRadius: 8, padding: 12 }}>
          <label style={{ marginBottom: 10 }}>{template.name}</label>
          {tfields.map((fld) => (
            <div className="field" key={fld.label} style={{ marginBottom: 8 }}>
              <label>{fld.label}{fld.required ? ' *' : ''}</label>
              {fld.type === 'number' ? (
                <input type="number" step="any" value={spec[fld.label] ?? ''}
                  onChange={(e) => setSpec({ ...spec, [fld.label]: e.target.value })} />
              ) : fld.type === 'select' ? (
                <select value={spec[fld.label] ?? ''} onChange={(e) => setSpec({ ...spec, [fld.label]: e.target.value })}>
                  <option value="">—</option>
                  {(fld.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : fld.type === 'multiselect' ? (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {(fld.options || []).map((o) => (
                    <label key={o} style={{ display: 'flex', alignItems: 'center', gap: 5, margin: 0, whiteSpace: 'nowrap' }}>
                      <input type="checkbox" style={{ width: 'auto' }}
                        checked={Array.isArray(spec[fld.label]) && spec[fld.label].includes(o)}
                        onChange={() => toggleMulti(fld.label, o)} />
                      {o}
                    </label>
                  ))}
                  {!(fld.options || []).length && <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>—</span>}
                </div>
              ) : (
                <input value={spec[fld.label] ?? ''} onChange={(e) => setSpec({ ...spec, [fld.label]: e.target.value })} />
              )}
            </div>
          ))}
        </div>
      )}

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
            {vendorsActive.map((v) => <option key={v.id} value={v.name}>{v.name}</option>)}
            <option value="__other__">{t('vendorOther')}</option>
          </select>
        )}
      </div>

      <div className="grid-2">
        <div className="field">
          <label>{t('unitPrice')} (₪)</label>
          <input type="number" step="0.01" value={f.est_price} onChange={set('est_price')} />
        </div>
        <div className="field">
          <label>{t('unitCount')}</label>
          <input type="number" min="0" value={f.quantity} onChange={set('quantity')} />
        </div>
        {/* The running total, because "20" against "100" is only obviously wrong
            once you see it resolve to ₪2,000. Labels alone did not stop it. */}
        {Number(f.est_price) > 0 && (
          <div className="field" style={{ alignSelf: 'end' }}>
            <label>&nbsp;</label>
            <div className="mono" style={{ padding: '9px 0', color: 'var(--text-dim)' }}>
              {t('lineTotalIs').replace('{v}', money(lineTotalOf(f)))}
            </div>
          </div>
        )}
      </div>
      <div className="grid-2">
        <div className="field">
          <label>{t('priority')}</label>
          <select value={f.priority_level_id} onChange={set('priority_level_id')}>
            <option value="">—</option>
            {levels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
        {isMentor && (
          <div className="field">
            <label>{t('status')}</label>
            <select value={f.status} onChange={set('status')}>
              {STATUSES.map((s) => <option key={s} value={s}>{t(s)}</option>)}
            </select>
          </div>
        )}
      </div>
      {!template && <div className="field"><label>{t('notes')}</label><textarea rows="2" value={f.notes} onChange={set('notes')} /></div>}
      {err && <div className="err">{err}</div>}
    </Modal>
  )
}
