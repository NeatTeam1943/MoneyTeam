import { useI18n } from '../lib/i18n'

export const SCOPES = ['frc', 'ftc', 'both']
export const SCOPE_COLOR = { frc: '#1100ff', ftc: '#ff9100', both: '#5b6472' }

export function TeamScopeBadge({ scope }) {
  const { t } = useI18n()
  const s = SCOPES.includes(scope) ? scope : 'both'
  return (
    <span className="pill" style={{ background: SCOPE_COLOR[s] + '22', color: SCOPE_COLOR[s] }}>
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
        <button key={s} type="button" className={'tab' + (cur === s ? ' active' : '')} onClick={() => onChange(s)}>
          {t('scope_' + s)}
        </button>
      ))}
    </div>
  )
}
