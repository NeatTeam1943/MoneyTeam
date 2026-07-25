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
  return rate
}

// Renders a ₪-only amount input by default. Clicking "currency" swaps in a
// foreign-amount + rate pair with a live-computed ILS preview; the rate is
// auto-suggested but fully editable, and switching back to ₪ just uses the
// plain amount again. `value` is always the final ILS number the parent form
// uses; `fx` (currency/amount/rate) is metadata only, for the audit columns.
export default function CurrencyAmountInput({ value, onChange, fx, onFxChange, placeholder }) {
  const { t } = useI18n()
  const [mode, setMode] = useState(fx?.currency ? 'foreign' : 'ils')
  const [loadingRate, setLoadingRate] = useState(false)
  const lastFetched = useRef(null)

  const currency = fx?.currency || 'USD'
  const foreignAmount = fx?.amount ?? ''
  const rate = fx?.rate ?? ''

  useEffect(() => {
    if (mode !== 'foreign' || lastFetched.current === currency) return
    lastFetched.current = currency
    setLoadingRate(true)
    fetchRate(currency)
      .then((r) => onFxChange({ ...fx, currency, rate: fx?.rate || r }))
      .catch(() => { /* keep whatever rate is already there — nothing to block on */ })
      .finally(() => setLoadingRate(false))
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
    onFxChange({ currency: c, amount: foreignAmount, rate: '' })
  }

  if (mode === 'ils') {
    return (
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input type="number" step="0.01" min="0" placeholder={placeholder} value={value}
          onChange={(e) => onChange(e.target.value)} style={{ flex: 1 }} />
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMode('foreign')}>{t('otherCurrency')}</button>
      </div>
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <select value={currency} onChange={(e) => setCurrency(e.target.value)} style={{ width: 80 }}>
          {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <input type="number" step="0.01" min="0" placeholder={t('amount')} value={foreignAmount}
          onChange={(e) => setForeign(e.target.value)} style={{ flex: 1 }} />
        <span style={{ color: 'var(--text-faint)' }}>×</span>
        <input type="number" step="0.0001" min="0" value={rate} placeholder={loadingRate ? '…' : t('rate')}
          onChange={(e) => setRate(e.target.value)} style={{ width: 90 }} />
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setMode('ils'); onFxChange(null) }}>₪</button>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 4 }}>
        {loadingRate ? t('fetchingRate') : `= ${value ? money(value) : '—'}`}
        {!loadingRate && rate && <> · {t('rateHint')}</>}
      </div>
    </div>
  )
}

// local import to avoid a circular dependency surprise if format.js grows
function money(n) { return `₪${Number(n).toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` }
