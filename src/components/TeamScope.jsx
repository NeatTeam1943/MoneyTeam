import { useI18n } from '../lib/i18n'

export const SCOPES = ['frc', 'ftc', 'both']
// FRC blue/orange, FTC red/white, shared neutral. The previous mapping gave
// FTC the orange — which is one of FRC's own colours and the app's "money out"
// colour — so the badge was wearing the wrong team's identity.
export const SCOPE_COLOR  = { frc: '#1100ff', ftc: '#c8102e', both: '#5b6472' }
export const SCOPE_ACCENT = { frc: '#ff9100', ftc: '#ffffff', both: '#c6cde0' }

export function TeamScopeBadge({ scope }) {
  const { t } = useI18n()
  const s = SCOPES.includes(scope) ? scope : 'both'
  return (
    // Solid fill with white text: visually distinct from warning pills, which
    // are tinted background with coloured text.
    <span className="pill" style={{
      background: s === 'both' ? 'transparent' : SCOPE_COLOR[s],
      color: s === 'both' ? SCOPE_COLOR[s] : '#fff',
      border: s === 'both' ? '1px solid var(--line-strong)' : 'none',
      borderInlineStart: s === 'both' ? undefined : `3px solid ${SCOPE_ACCENT[s]}`,
      fontWeight: 700,
    }}>
      {t('scope_' + s)}
    </span>
  )
}

export function TeamScopePicker({ value, onChange }) {
  const { t } = useI18n()
  const cur = SCOPES.includes(value) ? value : 'both'
  return (
    <div className="tabs" style={{ marginBottom: 0 }}>
      {SCOPES.map((s) => (
        <button key={s} type="button" className={'tab' + (cur === s ? ' active' : '')}
          onClick={() => onChange(s)}
          style={cur === s && s !== 'both'
            ? { background: SCOPE_COLOR[s], color: '#fff', borderColor: SCOPE_COLOR[s] }
            : undefined}>
          {t('scope_' + s)}
        </button>
      ))}
    </div>
  )
}
