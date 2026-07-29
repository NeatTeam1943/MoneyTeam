// Golden master for src/domain/shopping.js and src/domain/simulation.js.
// REFERENCE = the inline implementations before extraction.
import fs from 'fs'
import { filterRows, sortRows } from '/tmp/shopping.bundle.mjs'
import { projectAccounts, projectBudgets } from '/tmp/simulation.bundle.mjs'

const D = JSON.parse(fs.readFileSync('/tmp/gm3.json', 'utf8'))
const lineTotal = (r) => (Number(r?.est_price) || 0) * (r?.quantity == null ? 1 : Number(r.quantity) || 0)
const rankOf = Object.fromEntries(D.levels.map((l) => [l.id, l.rank]))
const catName = Object.fromEntries(D.cats.map((c) => [c.id, c.name]))
const lvlName = Object.fromEntries(D.levels.map((l) => [l.id, l.name]))
const t = (k) => k
const enriched = D.shopping.map((r) => ({ ...r, categoryName: catName[r.category_id] || '', priorityName: lvlName[r.priority_level_id] || '' }))

// ---- REFERENCE: Shopping filter + sort -------------------------------------
function refFilterSort(rows, q, fStatus, fPriority, sort) {
  const needle = q.trim().toLowerCase()
  const hit = (r) => !needle || [r.name, r.sku, r.vendor, r.categoryName, r.priorityName, r.notes, r.description]
    .some((v) => String(v || '').toLowerCase().includes(needle))
  const out = rows.filter((r) => hit(r) && (!fStatus || r.status === fStatus) && (!fPriority || r.priority_level_id === fPriority))
  const { col, dir } = sort
  const mul = dir === 'asc' ? 1 : -1
  const val = (r) => {
    if (col === 'priority') return rankOf[r.priority_level_id] ?? 999
    if (col === 'est_price') return Number(r.est_price) || 0
    if (col === 'quantity') return Number(r.quantity) || 0
    if (col === 'category') return r.categoryName || ''
    if (col === 'name') return r.name || ''
    if (col === 'vendor') return r.vendor || ''
    if (col === 'status') return t(r.status) || ''
    return r[col] ?? ''
  }
  out.sort((a, b) => { const av = val(a), bv = val(b); if (av < bv) return -1 * mul; if (av > bv) return 1 * mul; return 0 })
  return out
}

// ---- REFERENCE: Simulation projections -------------------------------------
const kids = {}; for (const c of D.cats) if (c.parent_id) (kids[c.parent_id] = kids[c.parent_id] || []).push(c.id)
const desc = (id) => { const a = new Set([id]), st = [id]; while (st.length) { const c = st.pop(); for (const k of kids[c] || []) if (!a.has(k)) { a.add(k); st.push(k) } } return a }
const budgetCat = Object.fromEntries(D.budgets.map((b) => [b.id, b.category_id]))

function refProjectAccounts(balances, incomes, picked, extras, fundBy, fundFrom) {
  const accountFor = (id) => fundBy[id] || fundFrom
  return balances.map((b) => {
    const inc = incomes.reduce((s, r) => s + (r.account_id === b.id ? (Number(r.amount) || 0) : 0), 0)
    const out = picked.reduce((s, r) => s + (accountFor(r.id) === b.id ? lineTotal(r) : 0), 0)
      + extras.reduce((s, e) => s + ((e.account_id || fundFrom) === b.id ? (Number(e.amount) || 0) : 0), 0)
    return { ...b, before: Number(b.balance), delta: inc - out, after: Number(b.balance) + inc - out }
  })
}
// UPDATED DELIBERATELY. The original reference matched spend by CATEGORY,
// which double-counted once FRC/FTC/shared pots shared a category — each
// showed the others' money and the simulation reported 498%, 1176%, 7742%.
// The Budgets page was fixed for this; projectBudgets was not. The reference
// now mirrors the ownership model, so the check pins the corrected behaviour
// rather than the bug.
const ownershipRef = (budgets) => {
  const byCat = {}
  for (const b of budgets) if (b.category_id) (byCat[b.category_id] = byCat[b.category_id] || []).push(b)
  const overall = budgets.filter((b) => !b.category_id)
  const parentOfCat = Object.fromEntries(D.cats.map((c) => [c.id, c.parent_id]))
  const map = {}
  for (const b of budgets) {
    if (!b.category_id) { map[b.id] = null; continue }
    let cur = parentOfCat[b.category_id]
    let anc = null
    while (cur) { if (byCat[cur]?.length) { anc = cur; break } cur = parentOfCat[cur] }
    const cands = anc ? byCat[anc].filter((x) => x.id !== b.id) : overall
    map[b.id] = (cands.find((x) => x.team_scope === b.team_scope)
      || cands.find((x) => x.team_scope === 'both') || null)?.id ?? null
  }
  return map
}
const ownedRef = (id, map) => {
  const children = {}
  for (const [k, v] of Object.entries(map)) if (v) (children[v] = children[v] || []).push(k)
  const out = new Set([id]); const st = [id]
  while (st.length) { const c = st.pop(); for (const k of children[c] || []) if (!out.has(k)) { out.add(k); st.push(k) } }
  return out
}

function refProjectBudgets(budgets, lines, picked, extras) {
  const own = ownershipRef(budgets)
  return budgets.map((b) => {
    const set = b.category_id ? desc(b.category_id) : null
    const inScope = (cid) => (b.category_id ? (cid && set.has(cid)) : true)
    const mine = ownedRef(b.id, own)
    const spent = lines.reduce((s, l) => s + (mine.has(l.budget_id) || (!b.category_id && l.budget_id == null) ? Number(l.amount) : 0), 0)
    const planned = picked.reduce((s, r) => s + (inScope(r.category_id) ? lineTotal(r) : 0), 0)
      + extras.reduce((s, e) => s + (inScope(e.category_id) ? (Number(e.amount) || 0) : 0), 0)
    const amount = Number(b.amount)
    const after = spent + planned
    const R = (n) => (Math.round((Number(n) || 0) * 100) / 100) || 0
    return { id: b.id, label: b.category_id ? (catName[b.category_id] || t('uncategorized')) : t('overall'),
      amount: R(amount), spent: R(spent), planned: R(planned), after: R(after), remaining: R(amount - after),
      pct: amount > 0 ? R((after / amount) * 100) : 0,
      wasOver: R(spent - amount) > 0 && amount > 0, nowOver: R(after - amount) > 0 && amount > 0 }
  })
}

let checks = 0, failures = 0
const eq = (label, a, b) => { checks++; if (JSON.stringify(a) !== JSON.stringify(b)) { failures++
  console.log(`  MISMATCH ${label}\n    ref ${JSON.stringify(a).slice(0,180)}\n    new ${JSON.stringify(b).slice(0,180)}`) } }

// shopping: every column, both directions, with and without a search term
for (const q of ['', 'kraken', 'אום', 'am-']) {
  for (const col of ['priority','name','est_price','quantity','category','vendor','status']) {
    for (const dir of ['asc','desc']) {
      const sort = { col, dir }
      eq(`shopping/${q||'(none)'}/${col}/${dir}`,
        refFilterSort(enriched, q, '', '', sort),
        sortRows(filterRows(enriched, { search: q, status: '', priority: '' }), sort,
          { rankOf, statusLabel: t }))
    }
  }
}
// with status / priority filters too
eq('shopping/status=approved', refFilterSort(enriched, '', 'approved', '', {col:'name',dir:'asc'}),
  sortRows(filterRows(enriched, { search:'', status:'approved', priority:'' }), {col:'name',dir:'asc'}, { rankOf, statusLabel: t }))

// simulation
const picked = D.shopping.filter((r) => ['approved','pending_approval'].includes(r.status)).slice(0, 8)
const extras = [{ id:'x1', label:'test', amount: 4500, category_id: D.cats[0].id, account_id: D.accounts[1]?.id }]
const incomes = [{ amount: 2000, account_id: D.accounts[0].id }]
const fundBy = Object.fromEntries(picked.map((r, i) => [r.id, D.accounts[i % D.accounts.length].id]))
const fundFrom = D.accounts[0].id
eq('sim/accounts', refProjectAccounts(D.balances, incomes, picked, extras, fundBy, fundFrom),
  projectAccounts({ balances: D.balances, incomes, picked, extras,
    accountFor: (id) => fundBy[id] || fundFrom, defaultAccount: fundFrom }))
eq('sim/budgets', refProjectBudgets(D.budgets, D.lines, picked, extras),
  projectBudgets({ budgets: D.budgets, lines: D.lines, picked, extras, budgetCategory: budgetCat,
    parentOf: Object.fromEntries(D.cats.map((c) => [c.id, c.parent_id])),
    inScopeFor: (b) => { const set = b.category_id ? desc(b.category_id) : null
      return (cid) => (b.category_id ? (cid && set.has(cid)) : true) },
    labelFor: (b) => (b.category_id ? (catName[b.category_id] || t('uncategorized')) : t('overall')) }))

console.log(`\n${checks} assertions, ${failures} mismatches`)
process.exit(failures ? 1 : 0)
