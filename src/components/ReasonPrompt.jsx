import { useState } from 'react'
import Modal from './Modal'
import { useI18n } from '../lib/i18n'

/**
 * "Why?" — asked before a change that sends a request backwards.
 *
 * Cancelling an item, bouncing it back for a measurement, parking it on a
 * sponsor: each of those is a decision somebody else has to live with, and the
 * person who raised the request is usually a student who was not in the room.
 * A note costs the person making the change five seconds and saves the other
 * one from guessing.
 *
 * The reason is REQUIRED, not optional. An optional box is left empty, and a
 * history of empty notes is the same as no history — which is what this exists
 * to avoid. The escape hatch is Cancel: nothing is changed at all.
 */
export default function ReasonPrompt({ title, what, count, onConfirm, onClose }) {
  const { t } = useI18n()
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function submit() {
    const clean = note.trim()
    if (!clean) { setErr(t('reasonRequired')); return }
    setErr(''); setBusy(true)
    try { await onConfirm(clean) } catch (e) { setErr(e.message || String(e)); setBusy(false) }
  }

  return (
    <Modal
      title={title || t('whyThisChange')}
      onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>{t('cancel')}</button>
        <button className="btn btn-primary" onClick={submit} disabled={busy}>
          {busy ? '…' : t('saveReason')}
        </button>
      </>}
    >
      {what && (
        <div style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 10 }}>
          {what}{count > 1 ? ` · ${t('nItems').replace('{n}', count)}` : ''}
        </div>
      )}
      <div className="field">
        <label>{t('reason')} *</label>
        <textarea rows="3" value={note} autoFocus
          placeholder={t('reasonPlaceholder')}
          onChange={(e) => setNote(e.target.value)} />
      </div>
      {err && <div className="err">{err}</div>}
    </Modal>
  )
}
