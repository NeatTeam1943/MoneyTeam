import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'
import { useTheme } from '../context/ThemeContext'
import { useAuth } from '../context/AuthContext'

export default function Login() {
  const { t, toggle, lang } = useI18n()
  const theme = useTheme()
  const { enterGuestMode } = useAuth()

  return (
    <div className="center-screen">
      <div className="login-card">
        <div style={{ position: 'absolute', top: 18, insetInlineEnd: 18 }}>
          <button className="btn btn-ghost btn-sm" onClick={theme.toggle} title={t('neatMode')}>
            {theme.isNeat ? '☀' : '🌙'}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={toggle}>{lang === 'he' ? 'EN' : 'עב'}</button>
        </div>
        <div className="panel panel-pad">
          <img src="./logo-full.png" alt="MoneyTeam · Neat Team 1943 · Mechanic Makers"
            className="login-logo" width="640" height="640" />
          <h1 style={{ fontSize: 22, margin: '10px 0 22px' }}>{t('loginTitle')}</h1>
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
            onClick={enterGuestMode}>
            {t('enterAsParent')}
          </button>
          <p style={{ color: 'var(--text-faint)', fontSize: 12, marginBottom: 0 }}>{t('parentViewHint')}</p>
        </div>
      </div>
    </div>
  )
}
