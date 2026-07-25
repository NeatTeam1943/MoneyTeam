import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../lib/toast'
import Modal from './Modal'

// fields: [{ key, label, type, options?, required?, default? }]
// type: 'text' | 'number' | 'date' | 'checkbox' | 'select' | 'color'
// manualId: true => the PK is entered by hand (used for members, id = auth uid)
// onChanged: optional callback fired after any add/edit/delete — lets a parent
// (e.g. the global SeasonContext) know this table changed and refetch itself.
export default function SimpleCrud({ table, fields, orderBy, manualId, canWrite, hint, invite, onChanged }) {
  const { t } = useI18n()
  const { session } = useAuth()
  const toast = useToast()
  const [rows, setRows] = useState([])
  const [editing, setEditing] = useState(null)
  const [open, setOpen] = useState(false)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [loading, setLoading] = useState(true)

  const [dynOpts, setDynOpts] = useState({})
  async function loadDyn() {
    const dyn = fields.filter((f) => f.dynamic)
    if (!dyn.length) return
    const res = await Promise.all(dyn.map((f) => supabase.from(f.dynamic).select('id,name').order('name')))
    const m = {}
    dyn.forEach((f, i) => { m[f.key] = res[i].data || [] })
    setDynOpts(m)
  }

  async function load() {
    try {
      const q = supabase.from(table).select('*')
      if (orderBy) q.order(orderBy)
      const { data, error } = await q
      if (!error) setRows(data || [])
      // refresh option lists too, so a new row shows up as a parent option
      // without needing a page refresh
      await loadDyn()
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    if (session?.user?.id) load()
    else setLoading(false)
  }, [table, session])

  function notifyChanged() { if (onChanged) onChanged() }

  async function del(row) {
    if (!confirm(t('confirmDelete'))) return
    await supabase.from(table).delete().eq('id', row.id)
    toast.success(t('deleted')); load(); notifyChanged()
  }

  return (
    <div>
      {hint && <p style={{ color: 'var(--text-faint)', fontSize: 13, marginTop: 0 }}>{hint}</p>}
      {canWrite && (
        <div className="toolbar">
          <div className="spacer" />
          {invite && <button className="btn" onClick={() => setInviteOpen(true)}>{t('inviteMember')}</button>}
          <button className="btn btn-primary" onClick={() => { setEditing(null); setOpen(true) }}>+ {t('add')}</button>
        </div>
      )}
      <div className="panel table-wrap">
        <table className="data">
          <thead>
            <tr>
              {fields.map((f) => <th key={f.key}>{f.label}</th>)}
              {canWrite && <th>{t('actions')}</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                {fields.map((f) => <td key={f.key}>{renderCell(r[f.key], f, dynOpts)}</td>)}
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
        {loading ? <div className="empty">{t('loading')}</div> : (!rows.length && <div className="empty">{t('noRows')}</div>)}
      </div>
      {open && (
        <CrudForm
          table={table} fields={fields} editing={editing} manualId={manualId} dynOpts={dynOpts}
          onClose={() => setOpen(false)}
          onSaved={() => { setOpen(false); toast.success(t('saved')); load(); notifyChanged() }}
        />
      )}
      {inviteOpen && (
        <InviteForm
          onClose={() => setInviteOpen(false)}
          onSent={() => { setInviteOpen(false); toast.success(t('inviteSent')); load() }}
          onError={(m) => toast.error(m)}
        />
      )}
    </div>
  )
}

function InviteForm({ onClose, onSent, onError }) {
  const { t } = useI18n()
  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [role, setRole] = useState('viewer')
  const [busy, setBusy] = useState(false)

  async function send() {
    if (!email) return
    setBusy(true)
    const { data, error } = await supabase.functions.invoke('invite_member', {
      body: { email, full_name: fullName, role },
    })
    setBusy(false)
    if (error || data?.error) { onError((data && data.error) || error.message); return }
    onSent()
  }

  return (
    <Modal
      title={t('inviteMember')}
      onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>{t('cancel')}</button>
        <button className="btn btn-primary" onClick={send} disabled={busy}>{busy ? '…' : t('sendInvite')}</button>
      </>}
    >
      <div className="field"><label>{t('email')}</label><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
      <div className="field"><label>{t('fullName')}</label><input value={fullName} onChange={(e) => setFullName(e.target.value)} /></div>
      <div className="field">
        <label>{t('role')}</label>
        <select value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="viewer">{t('viewer')}</option>
          <option value="editor">{t('editor')}</option>
          <option value="mentor">{t('mentor')}</option>
        </select>
      </div>
    </Modal>
  )
}

function renderCell(v, f, dynOpts = {}) {
  if (f.dynamic) return (dynOpts[f.key] || []).find((o) => o.id === v)?.name || '—'
  if (f.type === 'checkbox') return v ? '✓' : ''
  if (f.type === 'color') return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 12, height: 12, borderRadius: 3, background: v || '#8a8aa0' }} />{v || '—'}</span>
  if (f.type === 'select') return (f.options.find((o) => o.value === v)?.label) || v || '—'
  return v ?? '—'
}

function CrudForm({ table, fields, editing, manualId, dynOpts = {}, onClose, onSaved }) {
  const { t } = useI18n()
  const [f, setF] = useState(() => {
    const init = {}
    for (const fld of fields) init[fld.key] = editing?.[fld.key] ?? fld.default ?? (fld.type === 'checkbox' ? false : '')
    if (manualId) init.id = editing?.id || ''
    return init
  })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  async function save() {
    for (const fld of fields) {
      if (fld.required && (f[fld.key] === '' || f[fld.key] == null)) { setErr(`${t('requiredField')}: ${fld.label}`); return }
    }
    if (manualId && !f.id) { setErr(`${t('requiredField')}: ${t('memberUid')}`); return }
    setErr(''); setBusy(true)
    const payload = {}
    for (const fld of fields) {
      let v = f[fld.key]
      if (v === '') v = null
      if (fld.type === 'number' && v != null) v = Number(v)
      payload[fld.key] = v
    }
    let res
    if (editing) res = await supabase.from(table).update(payload).eq('id', editing.id)
    else if (manualId) res = await supabase.from(table).insert({ id: f.id, ...payload })
    else res = await supabase.from(table).insert(payload)
    setBusy(false)
    if (res.error) { setErr(res.error.message); return }
    onSaved()
  }

  const set = (k, val) => setF({ ...f, [k]: val })

  return (
    <Modal
      title={editing ? t('edit') : t('add')}
      onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>{t('cancel')}</button>
        <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? '…' : t('save')}</button>
      </>}
    >
      {manualId && !editing && (
        <div className="field">
          <label>{t('memberUid')}</label>
          <input value={f.id} onChange={(e) => set('id', e.target.value)} placeholder="auth uid" />
        </div>
      )}
      {fields.map((fld) => (
        <div className="field" key={fld.key}>
          <label>{fld.label}</label>
          {fld.type === 'checkbox' ? (
            <input type="checkbox" checked={!!f[fld.key]} onChange={(e) => set(fld.key, e.target.checked)} style={{ width: 'auto' }} />
          ) : fld.dynamic ? (
            <select value={f[fld.key] ?? ''} onChange={(e) => set(fld.key, e.target.value)}>
              <option value="">—</option>
              {(dynOpts[fld.key] || []).filter((o) => o.id !== editing?.id).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          ) : fld.type === 'select' ? (
            <select value={f[fld.key] ?? ''} onChange={(e) => set(fld.key, e.target.value)}>
              {fld.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          ) : fld.type === 'color' ? (
            <input type="color" value={f[fld.key] || '#8a8aa0'} onChange={(e) => set(fld.key, e.target.value)} style={{ height: 40 }} />
          ) : (
            <input type={fld.type === 'number' ? 'number' : fld.type === 'date' ? 'date' : 'text'} step={fld.type === 'number' ? 'any' : undefined}
              value={f[fld.key] ?? ''} onChange={(e) => set(fld.key, e.target.value)} />
          )}
        </div>
      ))}
      {err && <div className="err">{err}</div>}
    </Modal>
  )
}
