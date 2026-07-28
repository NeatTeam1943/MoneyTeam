import { useEffect, useMemo, useState } from 'react'
import { supabase, withTimeout } from '../lib/supabase'
import { useI18n } from '../lib/i18n'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../lib/toast'
import Modal from './Modal'

// fields: [{ key, label, type, options?, required?, default? }]
// type: 'text' | 'number' | 'date' | 'checkbox' | 'select' | 'color'
// manualId: true => the PK is entered by hand (used for members, id = auth uid)
// onChanged: optional callback fired after any add/edit/delete — lets a parent
// (e.g. the global SeasonContext) know this table changed and refetch itself.
// tree: true => rows have a parent_id and are listed as a hierarchy instead of
//   a flat alphabetical list, which for categories is the difference between
//   "אלקטרוניקה" appearing at random and appearing under "רובוט" where it lives.
export default function SimpleCrud({ table, fields, orderBy, manualId, canWrite, hint, onChanged, tree }) {
  const { t } = useI18n()
  const { session } = useAuth()
  const uid = session?.user?.id
  const toast = useToast()
  const [rows, setRows] = useState([])
  const [editing, setEditing] = useState(null)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const isMembers = table === 'members'
  const [selected, setSelected] = useState(() => new Set())

  // Parent before its children, depth-first. Rows whose parent is missing (or
  // that form a cycle) are appended at the end rather than silently dropped —
  // a category you cannot see is a category you cannot fix.
  const displayRows = useMemo(() => {
    if (!tree) return rows
    const byParent = {}
    for (const r of rows) {
      const k = r.parent_id || '__root__'
      ;(byParent[k] = byParent[k] || []).push(r)
    }
    const out = []
    const seen = new Set()
    const walk = (parentKey, depth) => {
      for (const r of byParent[parentKey] || []) {
        if (seen.has(r.id)) continue
        seen.add(r.id)
        out.push({ ...r, __depth: depth })
        walk(r.id, depth + 1)
      }
    }
    walk('__root__', 0)
    for (const r of rows) if (!seen.has(r.id)) out.push({ ...r, __depth: 0, __orphan: true })
    return out
  }, [rows, tree])

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
      const { data, error } = await withTimeout(q)
      if (!error) setRows(data || [])
      // refresh option lists too, so a new row shows up as a parent option
      // without needing a page refresh
      await withTimeout(loadDyn())
    } catch (e) {
      if (e.message === 'timeout') toast.error(t('loadTimedOut'))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    if (session?.user?.id) load()
    else setLoading(false)
  }, [table, uid])

  // Re-fetch on returning to the tab so a request Chrome dropped in the
  // background gets a fresh attempt. Already silent: load() only shows a
  // spinner on the very first call (loading starts true, then never gets
  // set back to true), so a returning-user refresh never blanks the table.
  useEffect(() => {
    const onFocus = () => { if (session?.user?.id) load() }
    const onVis = () => { if (!document.hidden) onFocus() }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVis)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [table, uid])

  function notifyChanged() { if (onChanged) onChanged() }

  async function del(row) {
    if (!confirm(t('confirmDelete'))) return
    await supabase.from(table).delete().eq('id', row.id)
    toast.success(t('deleted')); load(); notifyChanged()
  }

  // --- bulk selection (members table only) ---------------------------------
  const toggleOne = (id) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const toggleAll = () => setSelected((s) => (s.size === rows.length ? new Set() : new Set(rows.map((r) => r.id))))

  async function bulkSetViewer() {
    if (!selected.size) return
    if (!confirm(t('confirmBulkViewer').replace('{n}', selected.size))) return
    const { error } = await supabase.from('members').update({ role: 'viewer' }).in('id', [...selected])
    if (error) { toast.error(error.message); return }
    toast.success(t('saved')); setSelected(new Set()); load()
  }
  async function bulkDelete() {
    if (!selected.size) return
    if (!confirm(t('confirmBulkDelete').replace('{n}', selected.size))) return
    const { error } = await supabase.from('members').delete().in('id', [...selected])
    if (error) { toast.error(error.message); return }
    toast.success(t('deleted')); setSelected(new Set()); load()
  }

  return (
    <div>
      {hint && <p style={{ color: 'var(--text-faint)', fontSize: 13, marginTop: 0 }}>{hint}</p>}
      {canWrite && (
        <div className="toolbar">
          {isMembers && selected.size > 0 && (
            <>
              <span className="badge">{t('selectedCount').replace('{n}', selected.size)}</span>
              <button className="btn btn-sm" onClick={bulkSetViewer}>{t('setToViewer')}</button>
              <button className="btn btn-sm btn-danger" onClick={bulkDelete}>{t('deleteSelected')}</button>
            </>
          )}
          <div className="spacer" />
          <button className="btn btn-primary" onClick={() => { setEditing(null); setOpen(true) }}>+ {t('add')}</button>
        </div>
      )}
      <div className="panel table-wrap">
        <table className="data">
          <thead>
            <tr>
              {isMembers && canWrite && (
                <th><input type="checkbox" checked={rows.length > 0 && selected.size === rows.length} onChange={toggleAll} style={{ width: 'auto' }} /></th>
              )}
              {fields.map((f) => <th key={f.key}>{f.label}</th>)}
              {canWrite && <th>{t('actions')}</th>}
            </tr>
          </thead>
          <tbody>
            {displayRows.map((r) => (
              <tr key={r.id}>
                {isMembers && canWrite && (
                  <td><input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleOne(r.id)} style={{ width: 'auto' }} /></td>
                )}
                {fields.map((f, i) => (
                  <td key={f.key}>
                    {tree && i === 0
                      ? <TreeName row={r} value={r[f.key]} />
                      : renderCell(r[f.key], f, dynOpts)}
                  </td>
                ))}
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
    </div>
  )
}

// Indentation plus a branch glyph. Depth is drawn with em units so it tracks
// the font rather than a pixel guess.
function TreeName({ row, value }) {
  const depth = row.__depth || 0
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      {depth > 0 && (
        <span aria-hidden="true" style={{
          display: 'inline-block', width: `${depth * 1.15}em`,
          borderInlineStart: '2px solid var(--line-strong)', height: '1em',
          marginInlineEnd: 2,
        }} />
      )}
      {depth > 0 && <span aria-hidden="true" style={{ color: 'var(--text-faint)' }}>└</span>}
      <span style={{ fontWeight: depth === 0 ? 700 : 400 }}>{value}</span>
      {row.__orphan && <span className="pill" style={{ background: 'rgba(224,56,76,.12)', color: 'var(--danger)' }}>?</span>}
    </span>
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