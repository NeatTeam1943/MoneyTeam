import { useRef } from 'react'
import { useI18n } from '../lib/i18n'
import { fmtDate } from '../lib/format'

/**
 * A date field that reads dd.mm.yyyy in Hebrew.
 *
 * <input type="date"> draws its own text from the OS locale. No attribute, CSS
 * property or JS API changes that — the value is always yyyy-mm-dd internally
 * and the DISPLAY belongs to the browser, which is why Chrome shows 08/06/2026
 * for the 6th of August.
 *
 * An earlier attempt printed the correct date underneath. That was worse: the
 * screen then showed 08/06/2026 and 06.08.2026 together, two different-looking
 * dates for one day, and the reader has to work out which to believe.
 *
 * So the native text is hidden and ours is drawn in its place. The input is
 * still a real date input, stacked invisibly on top and filling the box, so
 * tapping anywhere opens the system picker and keyboard entry, min/max and form
 * behaviour all keep working. Only the glyphs are ours.
 *
 * In English the native format already matches expectations, so the control is
 * left completely alone.
 */
export default function DateField({ value, onChange, title, className, style, ...rest }) {
  const { t, lang } = useI18n()
  const ref = useRef(null)

  if (lang !== 'he') {
    return (
      <input ref={ref} type="date" value={value || ''} onChange={onChange}
        title={title} className={className} style={style} {...rest} />
    )
  }

  return (
    <span className={'date-he ' + (className || '')} style={style} title={title}>
      <span className="date-he-text" aria-hidden="true">
        {value ? fmtDate(value) : <span className="date-he-empty">{t('selectDate')}</span>}
      </span>
      <input
        ref={ref}
        type="date"
        value={value || ''}
        onChange={onChange}
        aria-label={title || t('date')}
        {...rest}
      />
    </span>
  )
}
