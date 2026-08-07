import Modal from './Modal'
import { useI18n } from '../lib/i18n'

/**
 * Read-only detail view for a row.
 *
 * Opening the edit form to answer "what is this?" is the wrong trade: it puts
 * every field into a writable state to satisfy a question, so a stray keystroke
 * becomes an edit, and a viewer or student — who may not edit at all — has no
 * way to look at the detail. This shows the same information with nothing to
 * type into, and offers the edit button to whoever is allowed to use it.
 */
export default function DetailPanel({ title, rows, onClose, onEdit, canEdit, footer }) {
  const { t } = useI18n()
  return (
    // confirmClose={false}: there is nothing to lose here. Asking "discard
    // unsaved changes?" on a view with no inputs is a question the reader
    // cannot answer, and it trains them to dismiss the warning that DOES
    // matter on the edit form.
    <Modal title={title} onClose={onClose} confirmClose={false} footer={
      <>
        <button className="btn btn-ghost" onClick={onClose}>{t('close')}</button>
        {canEdit && onEdit && (
          <button className="btn btn-primary" onClick={onEdit}>{t('edit')}</button>
        )}
      </>
    }>
      <dl className="detail-list">
        {rows.filter((r) => r && r.value !== null && r.value !== undefined && r.value !== '').map((r) => (
          <div key={r.label} className="detail-row">
            <dt>{r.label}</dt>
            <dd className={r.mono ? 'mono' : undefined} style={r.style}>{r.value}</dd>
          </div>
        ))}
      </dl>
      {footer}
    </Modal>
  )
}
