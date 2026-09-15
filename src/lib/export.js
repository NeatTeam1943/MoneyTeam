import * as XLSX from 'xlsx'
import { fmtDate, lineTotal } from './format'
import { sheet, summarySheet } from './sheetStyle'

// Every workbook starts with this sheet.
//
// A spreadsheet outlives the screen that produced it. Without a record of the
// season, the program filter and the date range, a file saved today is
// unreadable in three months: nobody can tell whether ₪16,169 was the whole
// purchase or one program's share of it. Worse, a filtered export looks
// exactly like a complete one. So the provenance travels with the numbers.
function provenanceSheet(meta = {}) {
  const scope = meta.scope || {}
  const programs = scope.all === false
    ? [scope.frc ? 'FRC' : null, scope.ftc ? 'FTC' : null].filter(Boolean).join(' + ')
    : 'FRC + FTC (all)'
  const rows = [
    { Field: 'Generated', Value: new Date().toISOString().replace('T', ' ').slice(0, 19) },
    { Field: 'Season', Value: meta.seasonName || '—' },
    { Field: 'Programs included', Value: programs },
    { Field: 'Filtered view', Value: scope.all === false ? 'YES — figures are a subset' : 'no' },
    { Field: 'Period', Value: meta.periodLabel || 'whole season' },
    { Field: 'Rows', Value: meta.rowCount ?? '—' },
  ]
  if (scope.all === false) {
    rows.push({ Field: 'NOTE', Value: 'Split purchases are counted at their in-view share, not the full receipt.' })
    rows.push({ Field: 'NOTE', Value: 'Income and bank balances are shared between programs and are NOT split; they appear in full.' })
  }
  // Two columns of label/value, so the widths follow the labels rather than
  // being guessed.
  return summarySheet([{ title: 'About this export', entries: rows.map((r) => [r.Field, r.Value]) }])
}

/**
 * Budgets, with what was actually spent against each.
 *
 * The sheet people asked for first, because a budget without its spend is a
 * wish list. Ordered by how far over or under each one is, so the rows that
 * need a decision are at the top rather than scattered alphabetically.
 */
export function exportBudgets(rows, meta = {}) {
  const wb = XLSX.utils.book_new()

  const data = [...rows]
    .sort((a, b) => (b.spent - b.amount) - (a.spent - a.amount))
    .map((r) => ({
      'קטגוריה': r.label,
      'תוכנית': r.team_scope === 'both' ? 'משותף' : (r.team_scope || '').toUpperCase(),
      'תקציב': Number(r.amount) || 0,
      'נוצל': Number(r.spent) || 0,
      'נותר': (Number(r.amount) || 0) - (Number(r.spent) || 0),
      'אחוז': r.amount > 0 ? Math.round((r.spent / r.amount) * 100) : 0,
      'סטטוס': r.spent > r.amount ? 'חריגה' : (r.amount > 0 && r.spent / r.amount < 0.25 ? 'כמעט לא נוצל' : ''),
    }))

  const over = data.filter((r) => r['סטטוס'] === 'חריגה')
  const idle = data.filter((r) => r['סטטוס'] === 'כמעט לא נוצל')

  XLSX.utils.book_append_sheet(wb, provenanceSheet({ ...meta, rowCount: data.length }), 'About')

  // The summary leads with what is wrong, for the same reason the report does:
  // a reader who has to add up a column to find the overspend will not.
  XLSX.utils.book_append_sheet(wb, summarySheet([
    { title: 'סיכום', entries: [
      ['סך תקציב', data.reduce((s, r) => s + r['תקציב'], 0)],
      ['סך נוצל', data.reduce((s, r) => s + r['נוצל'], 0)],
      ['סך נותר', data.reduce((s, r) => s + r['נותר'], 0)],
    ] },
    { title: 'חריגות', entries: over.length
      ? over.map((r) => [r['קטגוריה'], r['נוצל'] - r['תקציב']])
      : [['אין חריגות', '']] },
    { title: 'כמעט לא נוצלו', entries: idle.length
      ? idle.map((r) => [r['קטגוריה'], r['נותר']])
      : [['—', '']] },
  ]), 'סיכום')

  XLSX.utils.book_append_sheet(wb, sheet(data, {
    'תקציב': 'money', 'נוצל': 'money', 'נותר': 'money', 'אחוז': 'percent',
  }), 'תקציבים')

  // Writes the file itself, like the other three, so callers stay one line.
  const stamp = new Date().toISOString().slice(0, 10)
  const label = (meta.seasonName || 'budgets').replace(/[^\w\u0590-\u05FF-]+/g, '_')
  XLSX.writeFile(wb, `frc-budgets_${label}_${stamp}.xlsx`)
}

// rows: enriched transactions (with account/category/source names resolved)
// meta: { seasonName, accounts:[{name,balance}], periodLabel }
export function exportTransactions(rows, meta = {}) {
  const wb = XLSX.utils.book_new()

  const txSheet = rows.map((r) => ({
    Date: fmtDate(r.date),
    Type: r.type,
    Team: r.team_scope || 'both',
    // The full receipt, always. Under a program filter this is NOT what the
    // screen totals — hence the next column.
    Amount: Number(r.amount),
    'Amount in view': r._scopeAmount != null ? Number(r._scopeAmount) : Number(r.amount),
    Account: r.accountName || '',
    'To account': r.toAccountName || '',
    Source: r.sourceName || '',
    Category: r.categoryName || '',
    Vendor: r.vendor || '',
    Description: r.description || '',
    Budget: r.budgetName || '',
    Payer: r.payer_display || '',
    'Receipt ID': r.receipt_no || '',   // matches the filename inside the receipts ZIP
    Notes: r.notes || '',
  }))
  XLSX.utils.book_append_sheet(wb, provenanceSheet({ ...meta, rowCount: rows.length }), 'About')
  XLSX.utils.book_append_sheet(wb, sheet(txSheet, { Amount: 'money', Date: 'date' }), 'Transactions')

  // Summary by category (real expenses only; equipment donations excluded)
  const byCat = aggregate(rows.filter((r) => r.type === 'expense'), 'categoryName')
  XLSX.utils.book_append_sheet(wb, sheet(byCat, { Total: 'money' }), 'By category')

  // Summary by source (cash income only; equipment donations excluded)
  const bySrc = aggregate(rows.filter((r) => r.type === 'income'), 'sourceName')
  XLSX.utils.book_append_sheet(wb, sheet(bySrc, { Total: 'money' }), 'By source')

  if (meta.accounts?.length) {
    const balSheet = meta.accounts.map((a) => ({ Account: a.name, Balance: Number(a.balance) }))
    XLSX.utils.book_append_sheet(wb, sheet(balSheet, { Balance: 'money' }), 'Balances')
  }

  const stamp = new Date().toISOString().slice(0, 10)
  const label = (meta.periodLabel || meta.seasonName || 'all').replace(/[^\w\u0590-\u05FF-]+/g, '_')
  XLSX.writeFile(wb, `frc-finance_${label}_${stamp}.xlsx`)
}

function aggregate(rows, key) {
  const map = {}
  for (const r of rows) {
    const k = r[key] || '—'
    map[k] = (map[k] || 0) + Number(r.amount)
  }
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .map(([Name, Total]) => ({ Name, Total }))
}

// items: enriched shopping items (with categoryName resolved)
export function exportShopping(items, meta = {}) {
  const wb = XLSX.utils.book_new()
  const shoppingRows = items.map((r) => ({
    Name: r.name,
    Team: r.team_scope || 'both',
    SKU: r.sku || '',
    Category: r.categoryName || '',
    Vendor: r.vendor || '',
    'Unit price': r.est_price != null ? Number(r.est_price) : '',
    Units: r.quantity,
    'Est. total': r.est_price != null ? lineTotal(r) : '',
    Priority: r.priorityName || '',
    Status: r.status,
    Links: (r.urls?.length ? r.urls : (r.url ? [r.url] : [])).join('\n'),
    Notes: r.notes || '',
  }))
  XLSX.utils.book_append_sheet(wb, provenanceSheet({ ...meta, rowCount: items.length }), 'About')
  XLSX.utils.book_append_sheet(wb, sheet(shoppingRows, {
    'Unit price': 'money', 'Est. total': 'money', Units: 'int',
  }), 'Shopping')

  const byStatus = {}
  const byCat = {}
  for (const r of items) {
    const tot = lineTotal(r)
    byStatus[r.status] = (byStatus[r.status] || 0) + tot
    const c = r.categoryName || '—'
    byCat[c] = (byCat[c] || 0) + tot
  }
  XLSX.utils.book_append_sheet(wb, sheet(
    Object.entries(byStatus).map(([Status, Total]) => ({ Status, Total })),
    { Total: 'money' }), 'By status')
  XLSX.utils.book_append_sheet(wb, sheet(
    Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([Category, Total]) => ({ Category, Total })),
    { Total: 'money' }), 'By category')

  const stamp = new Date().toISOString().slice(0, 10)
  const label = (meta.seasonName || 'shopping').replace(/[^\w\u0590-\u05FF-]+/g, '_')
  XLSX.writeFile(wb, `frc-shopping_${label}_${stamp}.xlsx`)
}

// Download every receipt file for the given transactions as one ZIP.
// Each file is named after its Receipt ID (R-000042.jpg), which is the same
// value exported in the "Receipt ID" spreadsheet column — so a row in the
// Excel file and a file in the ZIP can always be matched up.
export async function downloadAllReceipts(rows, supabase, meta = {}, onProgress) {
  const withReceipts = rows.filter((r) => r.receipt_url && r.receipt_no)
  if (!withReceipts.length) return { count: 0 }

  const { default: JSZip } = await import('jszip')   // loaded only when used
  const zip = new JSZip()
  let done = 0
  let failed = 0

  for (const r of withReceipts) {
    try {
      const { data, error } = await supabase.storage.from('receipts').createSignedUrl(r.receipt_url, 120)
      if (error || !data?.signedUrl) throw error || new Error('no url')
      const res = await fetch(data.signedUrl)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const blob = await res.blob()
      const ext = (r.receipt_url.split('.').pop() || 'bin').split('?')[0].slice(0, 5)
      zip.file(`${r.receipt_no}.${ext}`, blob)
    } catch (e) {
      failed++
      console.error('receipt download failed', r.receipt_no, e)
    }
    done++
    if (onProgress) onProgress(done, withReceipts.length)
  }

  // A manifest so the ZIP is self-explanatory even without the spreadsheet
  zip.file('index.csv', 'Receipt ID,Date,Amount,Team,Vendor,Description\n' +
    withReceipts.map((r) => [r.receipt_no, r.date, r.amount, r.team_scope || 'both',
      (r.vendor || '').replace(/"/g, '""'), (r.description || '').replace(/"/g, '""')]
      .map((v) => `"${v ?? ''}"`).join(',')).join('\n'))

  const blob = await zip.generateAsync({ type: 'blob' })
  const stamp = new Date().toISOString().slice(0, 10)
  const label = (meta.seasonName || 'receipts').replace(/[^\w\u0590-\u05FF-]+/g, '_')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `frc-receipts_${label}_${stamp}.zip`
  a.click()
  URL.revokeObjectURL(a.href)
  return { count: withReceipts.length, failed }
}

// meta: { periodLabel, seasonName, totals, byMonth, byCategory, bySource, byAccount, topExpenses }
export function exportReport(meta) {
  const wb = XLSX.utils.book_new()
  const { totals = {} } = meta
  const summary = [
    { Metric: 'Income', Value: Number(totals.income || 0) },
    { Metric: 'Expense', Value: Number(totals.expense || 0) },
    // Net is withheld on screen under a partial filter because income is
    // shared and unsplit; writing 0 here would turn "unavailable" into a
    // number somebody would later trust.
    { Metric: 'Net', Value: totals.net == null ? 'n/a — filtered view, income is shared' : Number(totals.net) },
    // In-kind rows carry amount = 1 as a placeholder, so summing them is a
    // COUNT, not a value. Reporting it in a money column implied a shekel
    // figure the team never received.
    { Metric: 'In-kind donations (count)', Value: Number(totals.inkind || 0) },

  ]
  XLSX.utils.book_append_sheet(wb, provenanceSheet(meta), 'About')
  // Metric/Value pairs, so the summary opens as a readable block rather than a
  // two-column table with a header nobody needs.
  XLSX.utils.book_append_sheet(wb, summarySheet([
    { title: 'Summary', entries: summary.map((r) => [r.Metric, r.Value]) },
  ]), 'Summary')

  const named = (rows) => (rows || []).map((r) => ({ Name: r.name, Total: Number(r.value) }))
  const money1 = { Total: 'money' }
  XLSX.utils.book_append_sheet(wb, sheet(meta.byMonth || [], { Income: 'money', Expense: 'money', Net: 'money' }), 'By month')
  XLSX.utils.book_append_sheet(wb, sheet(named(meta.byCategory), money1), 'By category')
  XLSX.utils.book_append_sheet(wb, sheet(named(meta.bySource), money1), 'By source')
  XLSX.utils.book_append_sheet(wb, sheet(named(meta.byAccount), money1), 'By account')
  XLSX.utils.book_append_sheet(wb, sheet(named(meta.byVendor), money1), 'By vendor')
  XLSX.utils.book_append_sheet(wb, sheet(named(meta.byScope), money1), 'By program')
  XLSX.utils.book_append_sheet(wb, sheet(meta.cumulative || [], { Total: 'money' }), 'Cumulative')
  XLSX.utils.book_append_sheet(wb, sheet(meta.topExpenses || [], { Amount: 'money' }), 'Top expenses')

  // Goals belong in an exported report for the same reason they belong on the
  // page: they are a claim on money the other sheets treat as free, so a report
  // without them overstates what is available.
  if (meta.goals?.length) {
    XLSX.utils.book_append_sheet(wb, sheet(meta.goals, {
      Target: 'money', Reserved: 'money', 'Short by': 'money', Percent: 'percent',
    }), 'Goals')
  }

  const stamp = new Date().toISOString().slice(0, 10)
  const label = (meta.periodLabel || 'period').replace(/[^\w\u0590-\u05FF-]+/g, '_')
  XLSX.writeFile(wb, `frc-report_${label}_${stamp}.xlsx`)
}
