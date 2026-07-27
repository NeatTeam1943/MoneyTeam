import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'
import { useToast } from '../lib/toast'
import Modal from './Modal'

// Field kinds a template can ask for. 'text' is the implicit default so every
// template saved before this existed keeps working untouched — a field with no
// `type` is read as text.
export const FIELD_TYPES = ['text', 'number', 'select', 'multiselect']
export const hasOptions = (ty) => ty === 'select' || ty === 'multiselect'

// Mentor-managed shopping templates: a name + a list of typed fields.
export default function TemplatesManager({ canWrite }) {
  const { t } = useI18n()
  const toast = useToast()
  const [rows, setRows] = useState([])
  const [editing, setEditing] = useState(null)
  const [open, setOpen] = useState(false)

  async function load() {
    const { data, error } = await supabase.from('shopping_templates').select('*').order('name')
    if (error) return
    setRows(data || [])
  }
  useEffect(() => { load() }, [])

  async function del(row) {
    if (!confirm(t('confirmDelete'))) return
    await supabase.from('shopping_templates').delete().eq('id', row.id)
    toast.success(t('deleted')); load()
  }

  const describe = (f) => `${f.label}${f.required ? ' *' : ''} (${t('ftype_' + (f.type || 'text'))})`

  return (
    <div>
      <p style={{ color: 'var(--text-faint)', fontSize: 13, marginTop: 0 }}>{t('templatesHint')}</p>
      {canWrite && (
        <div className="toolbar"><div className="spacer" />
          <button className="btn btn-primary" onClick={() => { setEditing(null); setOpen(true) }}>+ {t('add')}</button>
        </div>
      )}
      <div className="panel table-wrap">
        <table className="data">
          <thead><tr><th>{t('name')}</th><th>{t('fields')}</th>{canWrite && <th>{t('actions')}</th>}</tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.name}</td>
                <td style={{ color: 'var(--text-dim)' }}>{(r.fields || []).map(describe).join(', ') || '—'}</td>
                {canWrite && (
                  <td>
                    <button className="btn btn-ghost btn-sm" onClick={() => { setEditing(r); setOpen(true) }}>{t('edit')}</button>
                    <button className="btn btn-ghost btn-sm btn-danger" onClick={() => del(r)}>{t('delete')}</button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <div className="empty">{t('noRows')}</div>}
      </div>
      {open && <TemplateForm editing={editing} onClose={() => setOpen(false)} onSaved={() => { setOpen(false); toast.success(t('saved')); load() }} />}
    </div>
  )
}

const emptyField = (required = false) => ({ label: '', required, type: 'text', options: [] })

function TemplateForm({ editing, onClose, onSaved }) {
  const { t } = useI18n()
  const [name, setName] = useState(editing?.name || '')
  const [fields, setFields] = useState(() => editing?.fields?.length
    ? editing.fields.map((f) => ({ ...emptyField(), ...f, type: f.type || 'text', options: f.options || [] }))
    : [emptyField(true)])
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const setField = (i, k, v) => setFields(fields.map((f, idx) => idx === i ? { ...f, [k]: v } : f))
  const addField = () => setFields([...fields, emptyField()])
  const removeField = (i) => setFields(fields.length > 1 ? fields.filter((_, idx) => idx !== i) : fields)

  async function save() {
    if (!name.trim()) { setErr(t('requiredField') + ': ' + t('name')); return }
    const clean = fields.filter((f) => f.label.trim()).map((f) => {
      const type = FIELD_TYPES.includes(f.type) ? f.type : 'text'
      const out = { label: f.label.trim(), required: !!f.required, type }
      if (hasOptions(type)) out.options = (f.options || []).map((o) => String(o).trim()).filter(Boolean)
      return out
    })
    if (!clean.length) { setErr(t('needOneField')); return }
    // A choice field with no choices is a dead end for whoever fills the form.
    const bad = clean.find((f) => hasOptions(f.type) && !f.options.length)
    if (bad) { setErr(t('needOptions') + ': ' + bad.label); return }
    setErr(''); setBusy(true)
    const payload = { name: name.trim(), fields: clean }
    const res = editing
      ? await supabase.from('shopping_templates').update(payload).eq('id', editing.id)
      : await supabase.from('shopping_templates').insert(payload)
    setBusy(false)
    if (res.error) { setErr(res.error.message); return }
    onSaved()
  }

  return (
    <Modal
      wide title={editing ? t('edit') : t('add')} onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>{t('cancel')}</button>
        <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? '…' : t('save')}</button>
      </>}
    >
      <div className="field"><label>{t('name')} *</label><input value={name} onChange={(e) => setName(e.target.value)} placeholder="למשל: ברגים" /></div>
      <div className="field">
        <label>{t('fields')}</label>
        {fields.map((f, i) => (
          <div key={i} style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 10, marginBottom: 8 }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <input value={f.label} onChange={(e) => setField(i, 'label', e.target.value)} placeholder={t('fieldLabel')} style={{ flex: '2 1 160px', minWidth: 140 }} />
              <select value={f.type} onChange={(e) => setField(i, 'type', e.target.value)} style={{ flex: '1 1 130px', minWidth: 120 }}>
                {FIELD_TYPES.map((ty) => <option key={ty} value={ty}>{t('ftype_' + ty)}</option>)}
              </select>
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, margin: 0, whiteSpace: 'nowrap' }}>
                <input type="checkbox" checked={!!f.required} onChange={(e) => setField(i, 'required', e.target.checked)} style={{ width: 'auto' }} />
                {t('required')}
              </label>
              <button className="btn btn-ghost btn-sm btn-danger" onClick={() => removeField(i)}>✕</button>
            </div>
            {hasOptions(f.type) && (
              <div style={{ marginTop: 8 }}>
                <input value={(f.options || []).join(', ')}
                  onChange={(e) => setField(i, 'options', e.target.value.split(',').map((o) => o.trimStart()))}
                  placeholder={t('optionsPlaceholder')} />
                <p style={{ color: 'var(--text-faint)', fontSize: 12, margin: '4px 0 0' }}>{t('optionsHint')}</p>
              </div>
            )}
          </div>
        ))}
        <button className="btn btn-sm" onClick={addField}>+ {t('addField')}</button>
      </div>
      {err && <div className="err">{err}</div>}
    </Modal>
  )
}
