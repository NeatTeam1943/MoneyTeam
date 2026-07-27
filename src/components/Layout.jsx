import { NavLink } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useSeason } from '../context/SeasonContext'
import { useI18n } from '../lib/i18n'
import { useTeamScope } from '../context/TeamScopeContext'

export default function Layout({ children }) {
  const { t, toggle, lang } = useI18n()
  const { member, role, signOut, isParent } = useAuth()
  const { seasons, activeId, setActiveId, loading: seasonsLoading } = useSeason()
  const ts = useTeamScope()

  const links = isParent
    ? [
      { to: '/', key: 'dashboard' },
      { to: '/transactions', key: 'transactions' },
    ]
    : [
      { to: '/', key: 'dashboard' },
      { to: '/transactions', key: 'transactions' },
      { to: '/budgets', key: 'budgets' },
      { to: '/shopping', key: 'shopping' },
      { to: '/reports', key: 'reports' },
      { to: '/simulation', key: 'simulation' },
      { to: '/settings', key: 'settings' },
    ]

  // Visible instead of silent: an empty <select> with no options used to fail
  // quietly and every save would error with a null season_id. Now it's obvious.
  const noSeasons = !seasonsLoading && seasons.length === 0

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="tick" />
          <div>
            <small>Neat Team 1943</small>
            <b>Finance</b>
          </div>
        </div>
        {links.map((l) => (
          <NavLink key={l.to} to={l.to} end={l.to === '/'} className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}>
            <span className="dot" />
            {t(l.key)}
          </NavLink>
        ))}
      </aside>

      <div className="main">
        <header className="topbar">
          {noSeasons ? (
            <span className="badge" style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}>
              {lang === 'he' ? 'אין עונה — צור עונה בהגדרות' : 'No season — create one in Settings'}
            </span>
          ) : (
            <select value={activeId || ''} onChange={(e) => setActiveId(e.target.value)} style={{ width: 'auto', minWidth: 160 }}>
              {seasons.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
          {/* Program checklist. Tick either, both, or one — rows marked
              "shared" always show, so ticking only FTC means "everything FTC
              touches", not "only rows literally tagged FTC". */}
          <div className="tabs" style={{ marginBottom: 0 }} title={t('teamScopeHint')}>
            <button className={'tab' + (ts.frc ? ' active' : '')} onClick={() => ts.toggle('frc')}>
              {ts.frc ? '☑' : '☐'} FRC
            </button>
            <button className={'tab' + (ts.ftc ? ' active' : '')} onClick={() => ts.toggle('ftc')}>
              {ts.ftc ? '☑' : '☐'} FTC
            </button>
          </div>
          <div className="spacer" />
          <button className="btn btn-ghost btn-sm" onClick={toggle}>{lang === 'he' ? 'EN' : 'עב'}</button>
          <span className="badge">{member?.full_name || member?.email} · {t(role || 'viewer')}</span>
          <button className="btn btn-ghost btn-sm" onClick={signOut}>{t('signOut')}</button>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  )
}
