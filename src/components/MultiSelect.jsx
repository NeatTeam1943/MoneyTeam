import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../lib/i18n'

/**
 * A closed dropdown that holds several selections at once.
 *
 * Written rather than installed. The npm options all bring their own styling
 * system and a few hundred kB, and this app has one place that needs the
 * control — a dependency that has to be kept current for one filter bar is a
 * poor trade.
 *
 * ── Two things that are easy to get wrong and are the whole job ─────────────
 *
 * KEYBOARD AND SCREEN READERS. A div that opens a list is not a control unless
 * it says so. This is a `button` with aria-expanded, the list is a
 * `listbox`, and each row is an `option` carrying aria-selected. Escape closes
 * it and returns focus to the button, so a keyboard user is never stranded
 * inside a panel with no way out.
 *
 * CLOSING. A dropdown that stays open when you click elsewhere feels broken.
 * That is a pointerdown listener on the document, removed when the panel
 * closes — not on click, because a click that starts inside and ends outside
 * (a drag over a label) would otherwise dismiss it mid-interaction.
 */
export default function MultiSelect({
  label,
  options,          // [{ value, label, count? }]
  selected,         // array of values
  onChange,
  allLabel,         // shown when nothing is selected
}) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)
  const buttonRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e) => {
      if (!wrapRef.current?.contains(e.target)) setOpen(false)
    }
    const onKey = (e) => {
      if (e.key === 'Escape') { setOpen(false); buttonRef.current?.focus() }
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const toggle = (value) => {
    onChange(selected.includes(value)
      ? selected.filter((v) => v !== value)
      : [...selected, value])
  }

  // The summary. Two names then a count: listing every one turns the control
  // into a paragraph, and a bare count ("3 selected") hides which three when
  // that is usually the thing you want to check at a glance.
  const summary = (() => {
    if (!selected.length) return allLabel || t('all')
    const names = selected
      .map((v) => options.find((o) => o.value === v)?.label)
      .filter(Boolean)
    if (names.length <= 2) return names.join(', ')
    return `${names.slice(0, 2).join(', ')} +${names.length - 2}`
  })()

  return (
    <div className="multiselect" ref={wrapRef}>
      <button
        type="button"
        ref={buttonRef}
        className="multiselect-button"
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="multiselect-label">{label}</span>
        <span className="multiselect-value">{summary}</span>
        <span className="multiselect-caret" aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>

      {open && (
        <div className="multiselect-panel" role="listbox" aria-multiselectable="true">
          {selected.length > 0 && (
            <button type="button" className="multiselect-clear"
              onClick={() => onChange([])}>
              {t('clearSelection')}
            </button>
          )}
          {options.map((o) => {
            const on = selected.includes(o.value)
            return (
              <div
                key={o.value}
                role="option"
                aria-selected={on}
                tabIndex={0}
                className={'multiselect-option' + (on ? ' is-selected' : '')}
                onClick={() => toggle(o.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(o.value) }
                }}
              >
                {/* readOnly and pointer-events:none in CSS: the ROW handles the
                    click, so the box must not fire a second toggle of its own. */}
                <input type="checkbox" checked={on} readOnly tabIndex={-1} />
                <span>{o.label}</span>
                {/* The count the status chips used to carry. It answers "is it
                    worth ticking this" before you tick it, and moving to a
                    dropdown would otherwise have quietly dropped it. */}
                {o.count != null && (
                  <span className="multiselect-count">{o.count}</span>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
