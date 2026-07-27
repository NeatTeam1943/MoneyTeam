import { useCallback, useEffect } from 'react'
import { useI18n } from '../lib/i18n'

// Accidental dismissals (a stray click on the backdrop, a reflex Escape) used
// to throw away a half-filled form silently. Those two paths now ask first;
// the explicit "close" and "cancel" buttons still close immediately, so there
// is always a friction-free way out.
export default function Modal({ title, onClose, children, footer, confirmClose = true, wide = false }) {
  const { t } = useI18n()

  const dismiss = useCallback(() => {
    if (confirmClose && !window.confirm(t('confirmDiscard'))) return
    onClose()
  }, [confirmClose, onClose, t])

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') dismiss() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dismiss])

  return (
    <div className="overlay" onClick={dismiss}>
      <div className={"modal panel" + (wide ? " modal-wide" : "")} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2 style={{ fontSize: 17 }}>{title}</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>{t('close')}</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  )
}
