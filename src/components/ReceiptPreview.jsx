import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'
import Modal from './Modal'

const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif', 'svg', 'heic', 'heif']

// A stored path should be bucket-relative. Older uploads occasionally kept the
// bucket name on the front, which makes the signed URL resolve to
// receipts/receipts/... and 404 — cheap to defend against.
export const normalisePath = (p) => String(p || '').replace(/^\/+/, '').replace(/^receipts\//, '')

export const extOf = (path) => {
  const clean = String(path || '').split('?')[0]
  const dot = clean.lastIndexOf('.')
  return dot === -1 ? '' : clean.slice(dot + 1).toLowerCase()
}

export const kindOf = (path, contentType) => {
  if (contentType) {
    if (contentType.startsWith('image/')) return 'image'
    if (contentType === 'application/pdf') return 'pdf'
    // storage returns JSON when it is reporting an error, never for a receipt
    if (contentType.includes('json')) return 'other'
  }
  const e = extOf(path)
  if (IMAGE_EXT.includes(e)) return 'image'
  if (e === 'pdf') return 'pdf'
  return 'other'
}

export default function ReceiptPreview({ path, number, onClose }) {
  const { t } = useI18n()
  const clean = normalisePath(path)
  const [url, setUrl] = useState(null)
  const [err, setErr] = useState('')
  const [diag, setDiag] = useState(null)     // { status, type }
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    setUrl(null); setErr(''); setDiag(null); setFailed(false)

    supabase.storage.from('receipts').createSignedUrl(clean, 600).then(({ data, error }) => {
      if (!alive) return
      if (error || !data?.signedUrl) { setErr(error?.message || t('receiptLoadFailed')); return }
      setUrl(data.signedUrl)
    })
    return () => { alive = false }
  }, [clean, t])

  // Diagnose ONLY after something actually fails to render.
  //
  // The previous version probed the URL up front with a `Range: bytes=0-0`
  // GET to check the object existed. That request is what broke the preview:
  // the browser cached the 1-byte 206 response, then <img> requested the same
  // URL, was served the truncated entry from cache, and could not decode it.
  // A perfectly good PNG reported "status 206, type image/png" and still
  // showed as broken — the check caused the failure it was reporting.
  //
  // Now nothing touches the URL before the element does, and the probe runs
  // only on error, with HEAD (no body, nothing to cache) and no-store.
  async function diagnose() {
    setFailed(true)
    if (!url || diag) return
    try {
      let res = await fetch(url, { method: 'HEAD', cache: 'no-store' })
      // Some storage backends reject HEAD on a signed URL; fall back to a
      // plain GET, still without a Range header.
      if (res.status === 405 || res.status === 501) {
        res = await fetch(url, { method: 'GET', cache: 'no-store' })
      }
      setDiag({ status: res.status, type: res.headers.get('content-type') || '' })
    } catch {
      setDiag({ status: 0, type: '' })
    }
  }

  const filename = clean.split('/').pop()
  const kind = kindOf(clean, diag?.type)

  const diagnostics = (
    <div className="empty-cta" style={{ textAlign: 'start' }}>
      <p style={{ fontWeight: 700, marginTop: 0 }}>{t('previewFailed')}</p>
      {/* A 2xx means storage handed the file over perfectly well and the
          browser still would not display it — saying "did not load from
          storage" there would send you hunting in the wrong place. */}
      <p style={{ color: 'var(--text-dim)', fontSize: 13 }}>
        {!diag ? t('previewChecking')
          : diag.status >= 200 && diag.status < 300 ? t('previewOkButUndisplayable')
            : t('previewDiag')}
      </p>
      <ul className="mono" style={{ fontSize: 12, color: 'var(--text-faint)', paddingInlineStart: 18, lineHeight: 1.9 }}>
        <li>{t('previewStatus')}: {diag ? (diag.status || 'network error') : '—'}</li>
        <li>{t('previewType')}: {diag?.type || '—'}</li>
        <li style={{ wordBreak: 'break-all' }}>{t('previewPath')}: {clean}</li>
      </ul>
      {url && <a className="btn btn-primary" href={url} target="_blank" rel="noreferrer">{t('openInNewTab')} ↗</a>}
    </div>
  )

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
      <div style={{ minHeight: '12rem' }}>
        {err && <div className="err">{err}</div>}
        {!url && !err && <div className="empty">{t('loading')}</div>}

        {url && failed && diagnostics}

        {url && !failed && kind === 'image' && (
          // alt is empty on purpose: a failed <img> would otherwise print the
          // filename next to a broken icon, which is what made this look like
          // the preview had rendered something.
          <img src={url} alt="" onError={diagnose}
            style={{ maxWidth: '100%', maxHeight: '68vh', display: 'block', margin: '0 auto', borderRadius: 8 }} />
        )}
        {url && !failed && kind === 'pdf' && (
          <object data={url} type="application/pdf"
            style={{ width: '100%', height: '68vh', border: '1px solid var(--line)', borderRadius: 8 }}>
            {/* iOS Safari refuses to render PDFs inline in an object/iframe */}
            {diagnostics}
          </object>
        )}
        {url && !failed && kind === 'other' && (
          <div className="empty-cta">
            <p>{t('noInlinePreview')} <span className="mono">.{extOf(clean) || '?'}</span></p>
            <a className="btn btn-primary" href={url} target="_blank" rel="noreferrer">{t('openInNewTab')} ↗</a>
          </div>
        )}

        <p className="mono" style={{ color: 'var(--text-faint)', fontSize: 12, margin: '10px 0 0', wordBreak: 'break-all' }}>{filename}</p>
      </div>
    </Modal>
  )
}
