import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'

// Google usually hands over a name automatically, but it might be in the
// wrong language, a nickname, or just not how the person wants to appear —
// so this lets them confirm or edit it before a mentor ever sees it.
export default function NameSetup({ user, onDone }) {
  const { t } = useI18n()
  const suggested = user?.user_metadata?.full_name || user?.user_metadata?.name || ''
  const [name, setName] = useState(suggested)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) { setErr(t('nameRequired')); return }
    setErr(''); setBusy(true)
    const { error } = await supabase.auth.updateUser({ data: { full_name: trimmed, name_confirmed: true } })
    setBusy(false)
    if (error) { setErr(error.message); return }
    onDone()
  }

  return (
    <div className="center-screen">
      <form className="login-card panel panel-pad" onSubmit={submit}>
        <div className="tick-lg" />
        <h2 style={{ marginBottom: 6 }}>{t('confirmYourName')}</h2>
        <p style={{ color: 'var(--text-dim)', fontSize: 14, marginBottom: 18 }}>{t('confirmNameHint')}</p>
        <div className="field">
          <label>{t('fullName')}</label>
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus required />
        </div>
        {err && <div className="err">{err}</div>}
        <button className="btn btn-primary" type="submit" disabled={busy} style={{ width: '100%', marginTop: 8 }}>
          {busy ? '…' : t('continue')}
        </button>
      </form>
    </div>
  )
}
