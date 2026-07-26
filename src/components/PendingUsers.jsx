import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'
import { useToast } from '../lib/toast'

export default function PendingUsers() {
  const { t } = useI18n()
  const toast = useToast()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [role, setRole] = useState('student')

  async function load() {
    const { data, error } = await supabase.from('pending_users').select('*').order('created_at', { ascending: false })
    if (!error) setRows(data || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  async function grant(row) {
    const { error } = await supabase.from('members').insert({ id: row.id, email: row.email, role })
    if (error) { toast.error(error.message); return }
    toast.success(t('saved'))
    load()
  }

  if (loading || !rows.length) return null   // nothing pending — stay out of the way

  return (
    <div className="panel panel-pad" style={{ marginBottom: 18, borderColor: 'var(--orange)' }}>
      <div className="section-title" style={{ marginTop: 0 }}>{t('pendingUsers')} ({rows.length})</div>
      <p style={{ color: 'var(--text-faint)', fontSize: 13, marginTop: 0 }}>{t('pendingUsersHint')}</p>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
        <label style={{ margin: 0, fontSize: 13 }}>{t('grantAs')}:</label>
        <select value={role} onChange={(e) => setRole(e.target.value)} style={{ width: 'auto' }}>
          <option value="student">{t('student')}</option>
          <option value="viewer">{t('viewer')}</option>
          <option value="mentor">{t('mentor')}</option>
        </select>
      </div>
      {rows.map((r) => (
        <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderTop: '1px solid var(--line)' }}>
          <span>{r.email}</span>
          <button className="btn btn-sm btn-primary" onClick={() => grant(r)}>{t('grantAccess')}</button>
        </div>
      ))}
    </div>
  )
}
