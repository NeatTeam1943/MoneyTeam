import { useI18n } from '../lib/i18n'
import { fmtDate } from '../lib/format'

/**
 * A date input with the chosen date echoed underneath in Hebrew order.
 *
 * The browser renders <input type="date"> using the OS locale, not the page's,
 * so a Hebrew-first app still shows mm/dd/yyyy on many machines. That cannot be
 * overridden — there is no CSS or attribute for it, and replacing the control
 * with three text boxes would lose the native picker, keyboard handling and
 * mobile behaviour, which is a bad trade for a formatting complaint.
 *
 * What matters is that nobody mis-reads which number is the day. 07/26/2026 is
 * unambiguous by luck; 07/08/2026 is not. Echoing the value as 08.07.2026
 * removes the doubt without giving up the native control.
 */
export default function DateField({ value, onChange, title, className, style }) {
  const { lang } = useI18n()
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 2, ...style }}>
      <input type="date" value={value || ''} onChange={onChange} title={title} className={className} />
      {/* Only in Hebrew: in English the native format already matches what the
          reader expects, and a second copy would just be noise. */}
      {value && lang === 'he' && (
        <small className="mono" style={{ color: 'var(--text-faint)', fontSize: 11 }}>
          {fmtDate(value)}
        </small>
      )}
    </span>
  )
}
