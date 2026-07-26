import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'

export default function Login() {
  const { t, toggle, lang } = useI18n()

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
        </div>
      </div>
    </div>
  )
}
