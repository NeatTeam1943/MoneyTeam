import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'

export default function Login() {
  const { t, toggle, lang } = useI18n()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setErr(''); setBusy(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setBusy(false)
    if (error) setErr(t('wrongCreds'))
  }

  return (
    <div className="center-screen">
      <div className="login-card">
        <div style={{ position: 'absolute', top: 18, insetInlineEnd: 18 }}>
          <button className="btn btn-ghost btn-sm" onClick={toggle}>{lang === 'he' ? 'EN' : 'עב'}</button>
        </div>
        <div className="panel panel-pad">
          <div className="tick-lg" />
          <small style={{ color: 'var(--text-faint)', letterSpacing: '.08em', textTransform: 'uppercase', fontSize: 11 }}>Neat Team 1943</small>
          <h1 style={{ fontSize: 22, margin: '4px 0 22px' }}>{t('loginTitle')}</h1>
          <form onSubmit={submit}>
            <div className="field">
              <label>{t('email')}</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />
            </div>
            <div className="field">
              <label>{t('password')}</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
            </div>
            {err && <div className="err">{err}</div>}
            <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', marginTop: 8 }} disabled={busy}>
              {busy ? '…' : t('signIn')}
            </button>
          </form>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '18px 0', color: 'var(--text-faint)', fontSize: 12 }}>
            <div style={{ flex: 1, height: 1, background: 'var(--line)' }} />
            {t('or')}
            <div style={{ flex: 1, height: 1, background: 'var(--line)' }} />
          </div>
          <button
            type="button"
            className="btn"
            style={{ width: '100%', justifyContent: 'center' }}
            onClick={() => supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin + window.location.pathname } })}
          >
            {t('signInWithGoogle')}
          </button>
        </div>
      </div>
    </div>
  )
}
