import { useEffect, useMemo, useRef, useState } from 'react'
import { useI18n } from '../lib/i18n'
import { money } from '../lib/format'
import { evaluate, namesIn } from '../domain/formula'
import {
  loadHistory, pushHistory, clearHistory,
  loadVars, saveVars, loadFormula, saveFormula,
} from '../lib/calcStore'

/**
 * A floating calculator, in two modes.
 *
 * PLAIN is the usual four operators, driven through the same evaluator as the
 * formula mode rather than a second implementation — so precedence behaves
 * identically in both and there is only one place for a bug to live.
 *
 * FORMULA is the one that earns its keep here: "students * foodPerStudent",
 * with the variables named, saved and editable. It is the arithmetic people do
 * on paper before they enter a budget, and doing it in the app means the
 * numbers that reach a budget are the ones that were actually worked out.
 *
 * Both persist to localStorage, so a half-finished calculation survives a
 * reload — which is the whole reason for keeping history at all.
 */
export default function Calculator() {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState('plain')

  const [expr, setExpr] = useState('')
  const [history, setHistory] = useState(() => loadHistory())
  const [vars, setVars] = useState(() => loadVars())
  const [formula, setFormula] = useState(() => loadFormula())
  const panelRef = useRef(null)

  useEffect(() => { saveVars(vars) }, [vars])
  useEffect(() => { saveFormula(formula) }, [formula])

  // Escape closes it. A floating panel with no keyboard exit is a trap for
  // anyone not using a mouse.
  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  const plainResult = useMemo(() => (expr.trim() ? evaluate(expr) : null), [expr])

  // Names the formula mentions, in the order written. Driven off the formula
  // itself so a variable appears the moment it is typed, rather than needing
  // to be declared first.
  const needed = useMemo(() => namesIn(formula), [formula])
  const varMap = useMemo(
    () => Object.fromEntries(vars.map((v) => [v.name, v.value])), [vars])
  const formulaResult = useMemo(
    () => (formula.trim() ? evaluate(formula, varMap) : null), [formula, varMap])

  const setVarValue = (name, value) => {
    setVars((prev) => prev.some((v) => v.name === name)
      ? prev.map((v) => (v.name === name ? { ...v, value } : v))
      : [...prev, { name, value }])
  }

  const commit = (label, result) => {
    if (!result || result.error) return
    setHistory(pushHistory({ label, value: result.value }))
  }

  const errText = (r) => {
    if (!r?.error) return null
    const key = {
      divZero: 'calcDivZero', unknownName: 'calcUnknownName',
      badChar: 'calcBadChar', badNumber: 'calcBadNumber',
      badValue: 'calcBadValue', unbalanced: 'calcUnbalanced',
      malformed: 'calcMalformed', empty: 'calcMalformed',
    }[r.error] || 'calcMalformed'
    return t(key).replace('{v}', r.at || '')
  }

  if (!open) {
    return (
      <button className="calc-fab" onClick={() => setOpen(true)}
        aria-label={t('calculator')} title={t('calculator')}>
        {/* Drawn rather than an emoji: an emoji is a different typeface on
            every phone, cannot take the button's colour, and renders at a
            size the button does not control. This inherits currentColor, so
            it stays legible on the orange in both themes. */}
        <svg width="23" height="23" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="1.7"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="4.5" y="2.5" width="15" height="19" rx="2.5" />
          <rect x="7.5" y="5.5" width="9" height="3.5" rx="1" />
          <circle cx="8.2" cy="13" r="1" fill="currentColor" stroke="none" />
          <circle cx="12" cy="13" r="1" fill="currentColor" stroke="none" />
          <circle cx="15.8" cy="13" r="1" fill="currentColor" stroke="none" />
          <circle cx="8.2" cy="17.2" r="1" fill="currentColor" stroke="none" />
          <circle cx="12" cy="17.2" r="1" fill="currentColor" stroke="none" />
          <circle cx="15.8" cy="17.2" r="1" fill="currentColor" stroke="none" />
        </svg>
      </button>
    )
  }

  return (
    <div className="calc-panel" ref={panelRef} role="dialog" aria-label={t('calculator')}>
      <div className="calc-head">
        <div className="calc-tabs">
          <button className={mode === 'plain' ? 'is-on' : ''}
            onClick={() => setMode('plain')}>{t('calcPlain')}</button>
          <button className={mode === 'formula' ? 'is-on' : ''}
            onClick={() => setMode('formula')}>{t('calcFormula')}</button>
        </div>
        <button className="calc-close" onClick={() => setOpen(false)}
          aria-label={t('close')}>✕</button>
      </div>

      {mode === 'plain' ? (
        <div className="calc-body">
          <input
            className="calc-input"
            value={expr}
            onChange={(e) => setExpr(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') commit(expr, plainResult) }}
            placeholder="2400 / 12 * 3"
            inputMode="decimal"
            autoFocus
          />
          <div className="calc-out">
            {plainResult?.error
              ? <span className="calc-err">{errText(plainResult)}</span>
              : plainResult && <b>{money(plainResult.value)}</b>}
          </div>

          <div className="calc-keys">
            {['7', '8', '9', '/', '4', '5', '6', '*', '1', '2', '3', '-', '0', '.', '(', ')']
              .map((k) => (
                <button key={k} onClick={() => setExpr((s) => s + k)}>{k}</button>
              ))}
            <button onClick={() => setExpr((s) => s + '+')}>+</button>
            <button onClick={() => setExpr((s) => s.slice(0, -1))}>⌫</button>
            <button onClick={() => setExpr('')}>C</button>
            <button className="calc-eq" onClick={() => commit(expr, plainResult)}>=</button>
          </div>
        </div>
      ) : (
        <div className="calc-body">
          <input
            className="calc-input"
            value={formula}
            onChange={(e) => setFormula(e.target.value)}
            placeholder={t('calcFormulaHint')}
            autoFocus
          />

          {/* A row per name the formula uses. Typing a new name into the
              formula makes its field appear — there is no separate "add a
              variable" step to forget. */}
          {needed.map((name) => (
            <div key={name} className="calc-var">
              <label>{name}</label>
              <input
                type="number"
                step="any"
                value={varMap[name] ?? ''}
                onChange={(e) => setVarValue(name, e.target.value)}
                placeholder="0"
              />
            </div>
          ))}

          <div className="calc-out">
            {formulaResult?.error
              ? <span className="calc-err">{errText(formulaResult)}</span>
              : formulaResult && <b>{money(formulaResult.value)}</b>}
          </div>

          {formulaResult && !formulaResult.error && (
            <button className="btn btn-sm btn-primary"
              onClick={() => commit(formula, formulaResult)}>
              {t('calcSaveResult')}
            </button>
          )}

          {vars.length > 0 && (
            <div className="calc-varlist">
              <div className="calc-varlist-head">
                <span>{t('calcSavedVars')}</span>
                <button onClick={() => setVars([])}>{t('clearFilter')}</button>
              </div>
              {vars.map((v) => (
                <div key={v.name} className="calc-var-row">
                  <span>{v.name}</span>
                  <span className="mono">{v.value || '—'}</span>
                  <button onClick={() => setVars((p) => p.filter((x) => x.name !== v.name))}
                    aria-label={t('delete')}>✕</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="calc-history">
        <div className="calc-history-head">
          <span>{t('calcHistory')}</span>
          {history.length > 0 && (
            <button onClick={() => setHistory(clearHistory())}>{t('clearFilter')}</button>
          )}
        </div>
        {history.length === 0
          ? <p className="calc-empty">{t('calcNoHistory')}</p>
          : history.map((h, i) => (
            <button key={i} className="calc-history-row"
              onClick={() => {
                // Tapping a past line puts it back in the input, which is what
                // history is for — re-running a calculation with one number
                // changed.
                if (mode === 'plain') setExpr(h.label)
                else setFormula(h.label)
              }}>
              <span className="calc-history-expr">{h.label}</span>
              <span className="mono">{money(h.value)}</span>
            </button>
          ))}
      </div>
    </div>
  )
}
