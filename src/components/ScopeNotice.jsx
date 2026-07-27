import { useI18n } from '../lib/i18n'
import { useTeamScope } from '../context/TeamScopeContext'
import { SCOPE_COLOR } from './TeamScope'

// Shown whenever the program checklist is narrowing the view.
//
// Without it, a filtered screen looks exactly like an unfiltered one, and the
// figures on it are answering a different question than the reader assumes.
// Income and bank balances are shared between the programs and are NOT split,
// so they appear in full here while expenses are narrowed — which is why the
// net figure is withheld rather than shown as a number that would be wrong.
export default function ScopeNotice() {
  const { t } = useI18n()
  const ts = useTeamScope()
  if (ts.all) return null
  const key = ts.frc ? 'frc' : 'ftc'
  const which = key.toUpperCase()
  const c = SCOPE_COLOR[key]
  return (
    <div className="panel panel-pad" style={{
      borderColor: c, borderInlineStartWidth: 4, borderInlineStartStyle: 'solid',
      background: c + '0f', marginBottom: 14, fontSize: 13,
    }}>
      <b style={{ color: c }}>{t('scopeFilterOn').replace('{p}', which)}</b>
      <div style={{ color: 'var(--text-dim)', marginTop: 4 }}>{t('scopeFilterNote')}</div>
    </div>
  )
}
