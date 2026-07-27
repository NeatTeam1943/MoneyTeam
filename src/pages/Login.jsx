import { supabase } from '../lib/supabase'
import { useState } from 'react'
import { useI18n } from '../lib/i18n'

export default function Login() {
  const { t, toggle, lang } = useI18n()
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  async function enterAsParent() {
    setBusy(true); setErr('')
    const { error } = await supabase.auth.signInAnonymously()
    setBusy(false)
    // The most likely failure by far is anonymous sign-ins being switched off
    // in the Supabase dashboard, so say that rather than echoing a raw error.
    if (error) setErr(t('guestSignInFailed'))
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
          <button
            type="button"
            className="btn btn-primary"
            style={{ width: '100%', justifyContent: 'center' }}
            onClick={() => supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin + window.location.pathname } })}
          >
            {t('signInWithGoogle')}
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '18px 0 14px' }}>
            <div style={{ flex: 1, height: 1, background: 'var(--line)' }} />
            <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>{t('or')}</span>
            <div style={{ flex: 1, height: 1, background: 'var(--line)' }} />
          </div>

          <button type="button" className="btn" style={{ width: '100%', justifyContent: 'center' }}
            onClick={enterAsParent} disabled={busy}>
            {busy ? '…' : t('enterAsParent')}
          </button>
          <p style={{ color: 'var(--text-faint)', fontSize: 12, marginBottom: 0 }}>{t('parentViewHint')}</p>
          {err && <div className="err">{err}</div>}
        </div>
      </div>
    </div>
  )
}
