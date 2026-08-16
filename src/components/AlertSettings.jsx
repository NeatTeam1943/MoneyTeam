import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useI18n } from '../lib/i18n'
import { money } from '../lib/format'

/**
 * Who gets emailed about overspend.
 *
 * Anyone can switch their OWN alerts on and off; only mentors can change
 * someone else's. Silencing your own email is not a finance decision, and
 * making people ask for it would mean they just filter the mail instead — which
 * looks like a working alert and is not one.
 *
 * Everyone can SEE the list. Alerting is a team arrangement, and a mentor needs
 * to be able to notice that nobody is subscribed.
 */
export default function AlertSettings() {
  const { t } = useI18n()
  const { session, isMentor } = useAuth()
  const uid = session?.user?.id

  const [members, setMembers] = useState([])
  const [prefs, setPrefs] = useState({})
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  const load = async () => {
    const [m, p] = await Promise.all([
      supabase.from('members').select('id,full_name,email,role').order('full_name'),
      supabase.from('alert_preferences').select('*'),
    ])
    if (!m.error) setMembers(m.data || [])
    if (!p.error) setPrefs(Object.fromEntries((p.data || []).map((r) => [r.member_id, r])))
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const canEdit = (memberId) => isMentor || memberId === uid

  const save = async (memberId, patch) => {
    setErr('')
    const current = prefs[memberId] || { member_id: memberId, overspend: false, min_amount: 0 }
    const next = { ...current, ...patch, member_id: memberId, updated_at: new Date().toISOString() }
    // Optimistic, because a checkbox that waits for a round trip feels broken.
    setPrefs((s) => ({ ...s, [memberId]: next }))
    const { error } = await supabase.from('alert_preferences').upsert(next, { onConflict: 'member_id' })
    if (error) { setErr(error.message); load() }
  }

  if (loading) return <div className="empty">{t('loading')}</div>

  return (
    <div>
      <p style={{ color: 'var(--text-faint)', fontSize: 13, marginTop: 0 }}>{t('alertsHint')}</p>
      {err && <div className="empty" style={{ color: 'var(--danger)' }}>{err}</div>}

      <div className="table-wrap">
        <table className="data">
          <thead><tr>
            <th>{t('name')}</th>
            <th>{t('alertOverspend')}</th>
            <th className="num">{t('alertMinAmount')}</th>

          </tr></thead>
          <tbody>
            {members.map((m) => {
              const p = prefs[m.id] || {}
              const editable = canEdit(m.id)
              return (
                <tr key={m.id}>
                  <td>
                    {m.full_name || m.email}
                    {m.id === uid && <span style={{ color: 'var(--text-faint)' }}> · {t('you')}</span>}
                  </td>
                  <td>
                    <input type="checkbox" checked={!!p.overspend} disabled={!editable}
                      onChange={(e) => save(m.id, { overspend: e.target.checked })} />
                  </td>
                  <td className="num">
                    {/* Purely a floor: below this an overspend is not worth an
                        email. It is NOT "tell me again once it grows by this
                        much" — there is no telling again. */}
                    <input type="number" step="1" min="0" style={{ width: '6rem' }}
                      value={p.min_amount ?? 0} disabled={!editable || !p.overspend}
                      onChange={(e) => save(m.id, { min_amount: Number(e.target.value) || 0 })} />
                  </td>

                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <p style={{ color: 'var(--text-faint)', fontSize: 12, marginTop: 10 }}>
        {isMentor ? t('alertsMentorNote') : t('alertsOwnNote')}
      </p>
    </div>
  )
}
