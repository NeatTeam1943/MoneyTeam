import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'

export default function AcceptInvite({ onDone }) {
  const { t } = useI18n()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    if (password.length < 6) { setErr(t('passwordTooShort')); return }
    if (password !== confirm) { setErr(t('passwordsDontMatch')); return }
    setErr(''); setBusy(true)
    const { error } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (error) { setErr(error.message); return }
    onDone()
  }

  return (
    <div className="center-screen">
      <form className="login-card panel panel-pad" onSubmit={submit}>
        <div className="tick-lg" />
        <h2 style={{ marginBottom: 6 }}>{t('welcomeSetPassword')}</h2>
        <p style={{ color: 'var(--text-dim)', fontSize: 14, marginBottom: 18 }}>{t('setPasswordHint')}</p>
        <div className="field">
          <label>{t('newPassword')}</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required />
        </div>
        <div className="field">
          <label>{t('confirmPassword')}</label>
          <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
        </div>
        {err && <div className="err">{err}</div>}
        <button className="btn btn-primary" type="submit" disabled={busy} style={{ width: '100%', marginTop: 8 }}>
          {busy ? '…' : t('setPasswordAndContinue')}
        </button>
      </form>
    </div>
  )
}
