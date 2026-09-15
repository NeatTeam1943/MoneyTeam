import * as XLSX from 'xlsx'

/**
 * Making a sheet readable, within what the library can actually do.
 *
 * The community build of SheetJS accepts a `s` (style) property on a cell and
 * then DROPS IT on write. Bold headers and fills are therefore not available,
 * and code that sets them looks like it is working while producing a plain
 * file. Everything here is a feature that survives:
 *
 *   !cols       column widths
 *   z           number formats — currency, dates, percentages
 *   !autofilter dropdown filters on the header row
 *
 * Freezing the header is NOT available: this build emits no frozen pane
 * whatever key you set. Checked by unzipping the output and reading the XML,
 * which is the only way to tell — the in-memory object accepts the key happily.
 *
 * Widths are measured from the CONTENT, not guessed. A fixed width is wrong
 * twice over: it truncates a long Hebrew category and wastes a screen on a
 * column of two-digit numbers.
 */

/** Rough display width of a value, in characters. */
function widthOf(v) {
  if (v == null) return 0
  const s = String(v)
  // Hebrew glyphs are wider than Latin at the same point size; 1.15 is close
  // enough that columns stop being visibly too narrow.
  return /[\u0590-\u05FF]/.test(s) ? s.length * 1.15 : s.length
}

/**
 * @param rows    array of plain objects, as json_to_sheet takes
 * @param formats { columnName: 'money' | 'date' | 'percent' | 'int' }
 */
export function sheet(rows, formats = {}) {
  const ws = XLSX.utils.json_to_sheet(rows)
  if (!rows.length) return ws

  const headers = Object.keys(rows[0])

  // ── widths ────────────────────────────────────────────────────────────────
  ws['!cols'] = headers.map((h) => {
    const longest = rows.reduce((m, r) => Math.max(m, widthOf(r[h])), widthOf(h))
    // Floor so a one-character column is still clickable; ceiling so one long
    // free-text description does not push every other column off the screen.
    return { wch: Math.min(Math.max(longest + 2, 8), 42) }
  })

  // ── number formats ────────────────────────────────────────────────────────
  const CODES = {
    money: '#,##0.00 "₪"',
    // Written so Excel right-aligns and sorts these as numbers. A currency
    // string would look identical and sort alphabetically — 9 after 10 — which
    // is the kind of error nobody notices until a total is wrong.
    int: '#,##0',
    percent: '0"%"',
    date: 'dd/mm/yyyy',
  }

  const range = XLSX.utils.decode_range(ws['!ref'])
  headers.forEach((h, col) => {
    const code = CODES[formats[h]]
    if (!code) return
    for (let r = range.s.r + 1; r <= range.e.r; r++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c: col })]
      if (cell && cell.t === 'n') cell.z = code
    }
  })

  // ── header row ────────────────────────────────────────────────────────────
  // Autofilter only. I tried three ways to freeze the header and checked the
  // generated XML each time: this build writes no <pane state="frozen">, so
  // any freeze code here would be a line that looks like it works and does
  // nothing. Autofilter DOES survive — verified in the unzipped file — and it
  // gives the sort and filter dropdowns, which is most of the value.
  ws['!autofilter'] = { ref: ws['!ref'] }

  return ws
}

/**
 * A titled block of label/value pairs — for the summary sheet that opens each
 * workbook.
 *
 * Separate from `sheet` because it is not tabular: no header row to freeze, no
 * filter, and two columns whose widths follow the labels rather than the data.
 */
export function summarySheet(sections) {
  const rows = []
  for (const { title, entries } of sections) {
    if (rows.length) rows.push({ A: '', B: '' })     // a blank line between blocks
    rows.push({ A: title, B: '' })
    for (const [k, v] of entries) rows.push({ A: k, B: v })
  }

  const ws = XLSX.utils.json_to_sheet(rows, { skipHeader: true })
  ws['!cols'] = [
    { wch: Math.min(Math.max(...rows.map((r) => widthOf(r.A))) + 2, 40) },
    { wch: 22 },
  ]
  return ws
}
