// Produces the exact same Excel workbooks as the in-app "ייצוא לאקסל" buttons
// (Transactions and Shopping), for every season, without anyone needing to
// click anything. Used by .github/workflows/backup.yml.
//
// Requires the SERVICE key (not the publishable one) because it must see
// every season's data regardless of RLS — this is an unattended backup job,
// not a logged-in user.

import { createClient } from '@supabase/supabase-js'
import * as XLSX from 'xlsx'
import { mkdir, writeFile } from 'node:fs/promises'

const url = process.env.SUPABASE_URL
const key = process.env.SERVICE_KEY
if (!url || !key) {
  console.error('Missing SUPABASE_URL / SERVICE_KEY')
  process.exit(1)
}
const supabase = createClient(url, key, { auth: { persistSession: false } })

const OUT = 'backup/excel'
const fmtDate = (d) => (d ? String(d).slice(0, 10) : '')
const safe = (s) => (s || 'season').replace(/[^\w\u0590-\u05FF-]+/g, '_')

// --- category tree + path, same shape the app builds client-side ---------
function buildPaths(categories) {
  const byId = Object.fromEntries(categories.map((c) => [c.id, c]))
  const pathOf = (id) => {
    const chain = []
    let cur = byId[id]
    while (cur) { chain.unshift(cur.name); cur = cur.parent_id ? byId[cur.parent_id] : null }
    return chain.join(' › ')
  }
  return Object.fromEntries(categories.map((c) => [c.id, pathOf(c.id)]))
}

function aggregate(rows, key) {
  const map = {}
  for (const r of rows) { const k = r[key] || '—'; map[k] = (map[k] || 0) + Number(r.amount) }
  return Object.entries(map).sort((a, b) => b[1] - a[1]).map(([Name, Total]) => ({ Name, Total }))
}

// --- Transactions workbook — mirrors exportTransactions() in src/lib/export.js
function buildTransactionsWorkbook(rows, accounts) {
  const wb = XLSX.utils.book_new()
  const sheet = rows.map((r) => ({
    Date: fmtDate(r.date),
    Type: r.type,
    Amount: Number(r.amount),
    Account: r.accountName || '',
    'To account': r.toAccountName || '',
    Source: r.sourceName || '',
    Category: r.categoryName || '',
    Vendor: r.vendor || '',
    Description: r.description || '',
    Budget: r.budgetName || '',
    'Receipt ID': r.receipt_no || '',
    Notes: r.notes || '',
  }))
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheet), 'Transactions')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(aggregate(rows.filter((r) => r.type === 'expense'), 'categoryName')), 'By category')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(aggregate(rows.filter((r) => r.type === 'income'), 'sourceName')), 'By source')
  if (accounts?.length) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
      accounts.map((a) => ({ Account: a.name, Balance: Number(a.balance) }))), 'Balances')
  }
  return wb
}

// --- Shopping workbook — mirrors exportShopping() in src/lib/export.js -----
function buildShoppingWorkbook(items) {
  const wb = XLSX.utils.book_new()
  const sheet = items.map((r) => ({
    Name: r.name,
    SKU: r.sku || '',
    Category: r.categoryName || '',
    Vendor: r.vendor || '',
    'Est. price': r.est_price != null ? Number(r.est_price) : '',
    Qty: r.quantity,
    'Est. total': r.est_price != null ? Number(r.est_price) * (r.quantity || 1) : '',
    Priority: r.priorityName || '',
    Status: r.status,
    Link: r.url || '',
    Notes: r.notes || '',
  }))
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheet), 'Shopping')

  const byStatus = {}, byCat = {}
  for (const r of items) {
    const tot = (r.est_price != null ? Number(r.est_price) : 0) * (r.quantity || 1)
    byStatus[r.status] = (byStatus[r.status] || 0) + tot
    const c = r.categoryName || '—'
    byCat[c] = (byCat[c] || 0) + tot
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
    Object.entries(byStatus).map(([Status, Total]) => ({ Status, Total }))), 'By status')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
    Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([Category, Total]) => ({ Category, Total }))), 'By category')
  return wb
}

async function main() {
  await mkdir(OUT, { recursive: true })

  // Shared reference data (same for every season)
  const [accountsQ, categoriesQ, sourcesQ, levelsQ] = await Promise.all([
    supabase.from('accounts').select('*'),
    supabase.from('categories').select('*'),
    supabase.from('income_sources').select('*'),
    supabase.from('priority_levels').select('*'),
  ])
  const accountName = Object.fromEntries((accountsQ.data || []).map((a) => [a.id, a.name]))
  const sourceName = Object.fromEntries((sourcesQ.data || []).map((s) => [s.id, s.name]))
  const levelName = Object.fromEntries((levelsQ.data || []).map((l) => [l.id, l.name]))
  const categoryPath = buildPaths(categoriesQ.data || [])
  const categoryName = Object.fromEntries((categoriesQ.data || []).map((c) => [c.id, c.name]))

  const { data: accountBalances } = await supabase.from('account_balances').select('*')

  const { data: seasons, error: seasonsErr } = await supabase.from('seasons').select('*').order('start_date')
  if (seasonsErr) { console.error(seasonsErr); process.exit(1) }

  for (const season of seasons || []) {
    const label = safe(season.name)
    console.log(`season: ${season.name}`)

    const [txQ, linesQ, budgetsQ, shoppingQ] = await Promise.all([
      supabase.from('transactions').select('*').eq('season_id', season.id),
      supabase.from('transaction_lines').select('transaction_id,budget_id,amount,transactions!inner(season_id)').eq('transactions.season_id', season.id),
      supabase.from('budgets').select('*').eq('season_id', season.id),
      supabase.from('shopping_items').select('*').eq('season_id', season.id),
    ])

    // budget label: category path, or "Overall" for the season-wide budget
    const budgetLabel = Object.fromEntries((budgetsQ.data || []).map((b) => [
      b.id, b.category_id ? (categoryPath[b.category_id] || categoryName[b.category_id] || '—') : 'Overall',
    ]))
    const linesByTx = {}
    for (const l of linesQ.data || []) (linesByTx[l.transaction_id] = linesByTx[l.transaction_id] || []).push(l)

    const txRows = (txQ.data || []).map((r) => {
      const ls = linesByTx[r.id] || []
      const budgetName = ls.length === 0 ? '' : ls.length === 1 ? (budgetLabel[ls[0].budget_id] || 'Overall') : `Split (${ls.length})`
      return {
        ...r,
        accountName: accountName[r.account_id] || '',
        toAccountName: accountName[r.to_account_id] || '',
        categoryName: categoryName[r.category_id] || '',   // used for in_kind rows
        sourceName: sourceName[r.income_source_id] || '',
        budgetName,
      }
    })

    const shoppingRows = (shoppingQ.data || []).map((r) => ({
      ...r,
      categoryName: categoryName[r.category_id] || '',
      priorityName: levelName[r.priority_level_id] || '',
    }))

    const txWb = buildTransactionsWorkbook(txRows, accountBalances)
    XLSX.writeFile(txWb, `${OUT}/frc-finance_${label}.xlsx`)

    const shWb = buildShoppingWorkbook(shoppingRows)
    XLSX.writeFile(shWb, `${OUT}/frc-shopping_${label}.xlsx`)
  }

  console.log(`done — ${(seasons || []).length} season(s) exported`)
}

main().catch((e) => { console.error(e); process.exit(1) })
