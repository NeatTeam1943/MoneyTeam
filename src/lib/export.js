import * as XLSX from 'xlsx'
import { fmtDate, lineTotal } from './format'

// rows: enriched transactions (with account/category/source names resolved)
// meta: { seasonName, accounts:[{name,balance}], periodLabel }
export function exportTransactions(rows, meta = {}) {
  const wb = XLSX.utils.book_new()

  const txSheet = rows.map((r) => ({
    Date: fmtDate(r.date),
    Type: r.type,
    Team: r.team_scope || 'both',
    Amount: Number(r.amount),
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
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(txSheet), 'Transactions')

  // Summary by category (real expenses only; equipment donations excluded)
  const byCat = aggregate(rows.filter((r) => r.type === 'expense'), 'categoryName')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(byCat), 'By category')

  // Summary by source (cash income only; equipment donations excluded)
  const bySrc = aggregate(rows.filter((r) => r.type === 'income'), 'sourceName')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(bySrc), 'By source')

  if (meta.accounts?.length) {
    const balSheet = meta.accounts.map((a) => ({ Account: a.name, Balance: Number(a.balance) }))
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(balSheet), 'Balances')
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
  const sheet = items.map((r) => ({
    Name: r.name,
    Team: r.team_scope || 'both',
    SKU: r.sku || '',
    Category: r.categoryName || '',
    Vendor: r.vendor || '',
    'Est. price': r.est_price != null ? Number(r.est_price) : '',
    Qty: r.quantity,
    'Est. total': r.est_price != null ? lineTotal(r) : '',
    Priority: r.priorityName || '',
    Status: r.status,
    Link: r.url || '',
    Notes: r.notes || '',
  }))
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheet), 'Shopping')

  const byStatus = {}
  const byCat = {}
  for (const r of items) {
    const tot = lineTotal(r)
    byStatus[r.status] = (byStatus[r.status] || 0) + tot
    const c = r.categoryName || '—'
    byCat[c] = (byCat[c] || 0) + tot
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
    Object.entries(byStatus).map(([Status, Total]) => ({ Status, Total }))), 'By status')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
    Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([Category, Total]) => ({ Category, Total }))), 'By category')

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
  zip.file('index.csv', 'Receipt ID,Date,Amount,Vendor,Description\n' +
    withReceipts.map((r) => [r.receipt_no, r.date, r.amount,
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
    { Metric: 'Net', Value: Number(totals.net || 0) },
    { Metric: 'In-kind', Value: Number(totals.inkind || 0) },
    { Metric: 'Period', Value: meta.periodLabel || '' },
    { Metric: 'Season', Value: meta.seasonName || '' },
  ]
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), 'Summary')

  const named = (rows) => (rows || []).map((r) => ({ Name: r.name, Total: Number(r.value) }))
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(meta.byMonth || []), 'By month')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(named(meta.byCategory)), 'By category')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(named(meta.bySource)), 'By source')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(named(meta.byAccount)), 'By account')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(named(meta.byVendor)), 'By vendor')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(named(meta.byScope)), 'By program')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(meta.cumulative || []), 'Cumulative')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(meta.topExpenses || []), 'Top expenses')

  const stamp = new Date().toISOString().slice(0, 10)
  const label = (meta.periodLabel || 'period').replace(/[^\w\u0590-\u05FF-]+/g, '_')
  XLSX.writeFile(wb, `frc-report_${label}_${stamp}.xlsx`)
}
