import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'
import Modal from './Modal'

const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif', 'svg']

export const extOf = (path) => {
  const clean = String(path || '').split('?')[0]
  const dot = clean.lastIndexOf('.')
  return dot === -1 ? '' : clean.slice(dot + 1).toLowerCase()
}
export const kindOf = (path) => {
  const e = extOf(path)
  if (IMAGE_EXT.includes(e)) return 'image'
  if (e === 'pdf') return 'pdf'
  return 'other'
}

// Opens a receipt inline instead of punting to a new tab. Images render
// directly; PDFs go in an <iframe>, which every current desktop browser draws
// with its built-in viewer. Anything else — and the live bucket really does
// contain a few stray .jsx/.md uploads — falls back to a plain download link
// rather than an empty grey box.
export default function ReceiptPreview({ path, number, onClose }) {
  const { t } = useI18n()
  const [url, setUrl] = useState(null)
  const [err, setErr] = useState('')
  const kind = kindOf(path)

  useEffect(() => {
    let alive = true
    // 10 minutes: long enough to actually read a multi-page PDF, short enough
    // that a copied link is not a lasting leak.
    supabase.storage.from('receipts').createSignedUrl(path, 600).then(({ data, error }) => {
      if (!alive) return
      if (error || !data?.signedUrl) setErr(error?.message || t('receiptLoadFailed'))
      else setUrl(data.signedUrl)
    })
    return () => { alive = false }
  }, [path, t])

  const filename = String(path || '').split('/').pop()

  return (
    <Modal
      wide confirmClose={false}
      title={`${t('receipt')}${number ? ' · ' + number : ''}`}
      onClose={onClose}
      footer={<>
        {url && <a className="btn" href={url} target="_blank" rel="noreferrer">{t('openInNewTab')} ↗</a>}
        {url && <a className="btn" href={url} download={filename}>{t('download')}</a>}
        <button className="btn btn-ghost" onClick={onClose}>{t('close')}</button>
      </>}
    >
      <div style={{ minHeight: 200 }}>
        {err && <div className="err">{err}</div>}
        {!url && !err && <div className="empty">{t('loading')}</div>}
        {url && kind === 'image' && (
          <img src={url} alt={filename}
            style={{ maxWidth: '100%', maxHeight: '68vh', display: 'block', margin: '0 auto', borderRadius: 8 }} />
        )}
        {url && kind === 'pdf' && (
          <iframe src={url} title={filename}
            style={{ width: '100%', height: '68vh', border: '1px solid var(--line)', borderRadius: 8 }} />
        )}
        {url && kind === 'other' && (
          <div className="empty-cta">
            <p>{t('noInlinePreview')} <span className="mono">.{extOf(path) || '?'}</span></p>
            <a className="btn btn-primary" href={url} target="_blank" rel="noreferrer">{t('openInNewTab')} ↗</a>
          </div>
        )}
        <p className="mono" style={{ color: 'var(--text-faint)', fontSize: 12, marginBottom: 0, wordBreak: 'break-all' }}>{filename}</p>
      </div>
    </Modal>
  )
}
