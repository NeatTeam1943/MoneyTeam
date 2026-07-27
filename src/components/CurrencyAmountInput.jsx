import { useState, useEffect, useRef } from 'react'
import { useI18n } from '../lib/i18n'

const CURRENCIES = ['USD', 'EUR', 'GBP']

// Suggests a conversion rate to ILS from Frankfurter (ECB daily reference
// rates — free, no key, CORS-enabled). If the fetch fails for any reason
// (offline, currency not found, API down), the caller just keeps whatever
// rate is already in the box — this never blocks entry, it only offers a
// starting point the person can freely overwrite.
async function fetchRate(currency) {
  const res = await fetch(`https://api.frankfurter.dev/v1/latest?base=${currency}&symbols=ILS`)
  if (!res.ok) throw new Error('rate fetch failed')
  const data = await res.json()
  const rate = data?.rates?.ILS
  if (!rate) throw new Error('no ILS rate returned')
  // `date` is the ECB reference date the rate belongs to — usually the last
  // working day, not today. Showing it is the difference between "a rate" and
  // "a rate you can defend to an auditor".
  return { rate, date: data?.date || null }
}

// Renders a ₪-only amount input by default. Clicking "currency" swaps in a
// foreign-amount + rate pair with a live-computed ILS preview; the rate is
// auto-suggested but fully editable, and switching back to ₪ just uses the
// plain amount again. `value` is always the final ILS number the parent form
// uses; `fx` (currency/amount/rate) is metadata only, for the audit columns.
//
// `compact` is for narrow columns (the expense-lines editor): the number gets
// the FULL width of its cell instead of sharing the row with the currency
// button, and the currency controls open on their own line underneath. Inline
// they were squeezed to a few characters and the amount was unreadable.
export default function CurrencyAmountInput({ value, onChange, fx, onFxChange, placeholder, compact = false }) {
  const { t } = useI18n()
  const [mode, setMode] = useState(fx?.currency ? 'foreign' : 'ils')
  const [loadingRate, setLoadingRate] = useState(false)
  const [rateDate, setRateDate] = useState(null)
  const [rateErr, setRateErr] = useState(false)
  const lastFetched = useRef(null)

  const currency = fx?.currency || 'USD'
  const foreignAmount = fx?.amount ?? ''
  const rate = fx?.rate ?? ''

  // Auto-fetch happens ONCE per currency, and deliberately does not overwrite a
  // rate that is already set: on an existing purchase that rate is the historic
  // one the money actually changed hands at, and silently refreshing it would
  // rewrite history. Use ↻ to pull today's rate on purpose.
  function loadRate({ overwrite }) {
    setLoadingRate(true); setRateErr(false)
    return fetchRate(currency)
      .then(({ rate: r, date }) => {
        setRateDate(date)
        const next = overwrite ? r : (fx?.rate || r)
        onFxChange({ ...fx, currency, rate: next })
        if (overwrite) {
          const ils = (Number(foreignAmount) || 0) * (Number(next) || 0)
          onChange(ils ? String(Math.round(ils * 100) / 100) : '')
        }
      })
      .catch(() => setRateErr(true))   // keep whatever rate is there — never block entry
      .finally(() => setLoadingRate(false))
  }

  useEffect(() => {
    if (mode !== 'foreign' || lastFetched.current === currency) return
    lastFetched.current = currency
    loadRate({ overwrite: false })
  }, [mode, currency])   // eslint-disable-line react-hooks/exhaustive-deps

  function setForeign(amt) {
    const ils = (Number(amt) || 0) * (Number(rate) || 0)
    onFxChange({ currency, amount: amt, rate })
    onChange(ils ? String(Math.round(ils * 100) / 100) : '')
  }
  function setRate(r) {
    const ils = (Number(foreignAmount) || 0) * (Number(r) || 0)
    onFxChange({ currency, amount: foreignAmount, rate: r })
    onChange(ils ? String(Math.round(ils * 100) / 100) : '')
  }
  function setCurrency(c) {
    lastFetched.current = null
    setRateDate(null)
    onFxChange({ currency: c, amount: foreignAmount, rate: '' })
  }

  const amountBox = (
    <input type="number" step="0.01" min="0" placeholder={placeholder} value={value}
      onChange={(e) => onChange(e.target.value)}
      className={compact ? undefined : 'amount-input'}
      style={compact ? { width: '100%' } : undefined} />
  )

  if (mode === 'ils') {
    if (compact) {
      return (
        <div>
          {amountBox}
          <button type="button" className="btn btn-ghost btn-sm"
            style={{ padding: '2px 4px', fontSize: 11, marginTop: 2 }}
            onClick={() => setMode('foreign')}>{t('otherCurrency')}</button>
        </div>
      )
    }
    return (
      <div className="amount-row">
        {amountBox}
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMode('foreign')}>{t('otherCurrency')}</button>
      </div>
    )
  }

  // Foreign mode. In compact columns the ILS total keeps the first line to
  // itself and the currency/amount/rate controls flow onto the line(s) below;
  // flexWrap does the same job at any width, so nothing is ever crushed.
  return (
    <div>
      {compact && amountBox}
      <div className="fx-row" style={{ marginTop: compact ? 6 : 0 }}>
        <select className="fx-currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
          {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <input className="fx-amount" type="number" step="0.01" min="0" placeholder={t('amount')} value={foreignAmount}
          onChange={(e) => setForeign(e.target.value)} />
        <span style={{ color: 'var(--text-faint)' }}>×</span>
        <input className="fx-rate" type="number" step="0.0001" min="0" value={rate} placeholder={loadingRate ? '…' : t('rate')}
          onChange={(e) => setRate(e.target.value)} />
        <button type="button" className="btn btn-ghost btn-sm" title={t('refreshRate')}
          onClick={() => loadRate({ overwrite: true })} disabled={loadingRate}>↻</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setMode('ils'); onFxChange(null) }}>₪</button>
      </div>
      <div className="fx-note">
        {loadingRate ? t('fetchingRate') : `= ${value ? money(value) : '—'}`}
        {!loadingRate && rate ? <> · {rateDate ? `${t('rateSource')} ${rateDate}` : t('rateManual')} · {t('rateHint')}</> : null}
        {rateErr && <> · <span style={{ color: 'var(--danger)' }}>{t('rateFetchFailed')}</span></>}
      </div>
    </div>
  )
}

// local import to avoid a circular dependency surprise if format.js grows
function money(n) { return `₪${Number(n).toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` }
