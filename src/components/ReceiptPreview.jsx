import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'
import Modal from './Modal'
import { RECEIPT_URL_TTL_SECONDS, LARGE_IMAGE_BYTES } from '../domain/constants'

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

// What the first bytes actually are, regardless of what content-type claims.
// Storage records the MIME type the browser reported at upload time; it never
// looks inside the file. So a truncated or mis-saved upload keeps saying
// "image/png" while holding something no decoder will accept.
const SIGNATURES = [
  { name: 'PNG',  bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { name: 'JPEG', bytes: [0xff, 0xd8, 0xff] },
  { name: 'GIF',  bytes: [0x47, 0x49, 0x46, 0x38] },
  { name: 'PDF',  bytes: [0x25, 0x50, 0x44, 0x46] },
  { name: 'BMP',  bytes: [0x42, 0x4d] },
  { name: 'WEBP', bytes: [0x52, 0x49, 0x46, 0x46] },
  { name: 'TIFF', bytes: [0x49, 0x49, 0x2a, 0x00] },   // little-endian
  { name: 'TIFF', bytes: [0x4d, 0x4d, 0x00, 0x2a] },   // big-endian
  { name: 'ICO',  bytes: [0x00, 0x00, 0x01, 0x00] },
  { name: 'HEIC', bytes: [], offset: 4, ascii: 'ftyp' },
]

// Formats a browser will actually paint. TIFF is the one that catches people
// out: every image tool writes it, no browser except Safari reads it, and a
// file named .png can hold it quite happily — storage records the MIME type
// the browser guessed from the extension at upload, never what is inside.
// HEIC matters just as much in practice: it is the iPhone camera default.
const BROWSER_RENDERABLE = ['PNG', 'JPEG', 'GIF', 'WEBP', 'BMP', 'SVG']
export const canBrowserRender = (signature) => !signature || BROWSER_RENDERABLE.includes(signature)

export function identifyBytes(buf) {
  const b = new Uint8Array(buf)
  if (!b.length) return 'empty'
  for (const sig of SIGNATURES) {
    if (sig.ascii) {
      const s = String.fromCharCode(...b.slice(sig.offset, sig.offset + sig.ascii.length))
      if (s === sig.ascii) return sig.name
      continue
    }
    if (sig.bytes.every((v, i) => b[i] === v)) return sig.name
  }
  const hex = [...b.slice(0, 8)].map((v) => v.toString(16).padStart(2, '0')).join(' ')
  return `unrecognised (${hex})`
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
  const [forceShow, setForceShow] = useState(false)

  useEffect(() => {
    let alive = true
    setUrl(null); setErr(''); setDiag(null); setFailed(false); setForceShow(false)

    supabase.storage.from('receipts').createSignedUrl(clean, RECEIPT_URL_TTL_SECONDS).then(({ data, error }) => {
      if (!alive) return
      if (error || !data?.signedUrl) { setErr(error?.message || t('receiptLoadFailed')); return }
      setUrl(data.signedUrl)
      // HEAD only. This is safe in a way the previous `Range: bytes=0-0` GET
      // was not: there is no body, so nothing can land in the cache for the
      // <img> to pick up. Knowing the size up front lets us avoid handing the
      // browser something it cannot decode.
      // Both probes use cache: 'no-store', so nothing they fetch can be served
      // back to the <img> later. That single option is what was missing from
      // the original Range probe, and why it broke the thing it measured.
      Promise.all([
        fetch(data.signedUrl, { method: 'HEAD', cache: 'no-store' }),
        fetch(data.signedUrl, { headers: { Range: 'bytes=0-15' }, cache: 'no-store' })
          .then((r) => r.arrayBuffer()).then(identifyBytes).catch(() => null),
      ]).then(([res, signature]) => {
        if (!alive) return
        setDiag({
          status: res.status,
          type: res.headers.get('content-type') || '',
          length: res.headers.get('content-length'),
          disposition: res.headers.get('content-disposition') || '',
          signature,
        })
      }).catch(() => { /* the element will report its own failure */ })
    })
    return () => { alive = false }
  }, [clean, t])

  const byteSize = Number(diag?.length) || 0
  const isHuge = byteSize > LARGE_IMAGE_BYTES
  // Only block once we actually know the format — before the probe returns,
  // signature is null and canBrowserRender is permissive, so a normal receipt
  // is never delayed.
  const unsupported = diag?.signature != null && !canBrowserRender(diag.signature)

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
      // Size is the tell: a few bytes means the object is truncated in the
      // bucket, a huge one means the browser gave up decoding it. Without it
      // "200 image/png" says the file is fine while it plainly is not.
      // Read just the head of the file to see what it really is. Safe here:
      // this runs only AFTER a failure, and no-store keeps it out of the cache
      // (the earlier version did this BEFORE rendering and poisoned the entry
      // the <img> then loaded).
      let signature = null
      try {
        const head = await fetch(url, { headers: { Range: 'bytes=0-15' }, cache: 'no-store' })
        signature = identifyBytes(await head.arrayBuffer())
      } catch { /* signature is a bonus, not a requirement */ }
      setDiag({
        status: res.status,
        type: res.headers.get('content-type') || '',
        length: res.headers.get('content-length'),
        disposition: res.headers.get('content-disposition') || '',
        signature,
      })
    } catch {
      setDiag({ status: 0, type: '', length: null })
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
          : (diag.signature && diag.type && !diag.type.toLowerCase().includes(String(diag.signature).toLowerCase().slice(0, 3)))
            ? t('previewCorrupt').replace('{claimed}', diag.type).replace('{actual}', diag.signature)
            : diag.status >= 200 && diag.status < 300 ? t('previewOkButUndisplayable')
              : t('previewDiag')}
      </p>
      <ul className="mono" style={{ fontSize: 12, color: 'var(--text-faint)', paddingInlineStart: 18, lineHeight: 1.9 }}>
        <li>{t('previewStatus')}: {diag ? (diag.status || 'network error') : '—'}</li>
        <li>{t('previewType')}: {diag?.type || '—'}</li>
        <li>{t('previewSize')}: {diag?.length ? `${Number(diag.length).toLocaleString()} B` : '—'}</li>
        <li>{t('previewSignature')}: {diag?.signature || '—'}</li>
        {diag?.disposition && <li>content-disposition: {diag.disposition}</li>}
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

        {/* A format no browser paints: say so by name rather than showing a
            broken icon and blaming the size. */}
        {url && !failed && kind === 'image' && unsupported && (
          <div className="empty-cta">
            <p style={{ fontWeight: 700, marginTop: 0 }}>{t('unsupportedFormatTitle')}</p>
            <p style={{ color: 'var(--text-dim)', fontSize: 13 }}>
              {t('unsupportedFormatBody').replace('{fmt}', diag.signature)}
            </p>
            <a className="btn btn-primary" href={url} download={filename}>{t('download')}</a>
          </div>
        )}
        {/* Big images get an explicit choice instead of a broken icon. */}
        {url && !failed && kind === 'image' && !unsupported && isHuge && !forceShow && (
          <div className="empty-cta">
            <p style={{ fontWeight: 700, marginTop: 0 }}>{t('largeImageTitle')}</p>
            <p style={{ color: 'var(--text-dim)', fontSize: 13 }}>
              {t('largeImageBody').replace('{v}', (byteSize / (1024 * 1024)).toFixed(1))}
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
              <a className="btn btn-primary" href={url} target="_blank" rel="noreferrer">{t('openInNewTab')} ↗</a>
              <button className="btn" onClick={() => setForceShow(true)}>{t('displayAnyway')}</button>
            </div>
          </div>
        )}
        {url && !failed && kind === 'image' && !unsupported && (!isHuge || forceShow) && (
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
