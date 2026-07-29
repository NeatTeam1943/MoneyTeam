// Guards the rule that unapproved money must never reach a figure.
//
// Since migration 23 the defence is structural: aggregations read
// ledger_transactions / ledger_lines_full, which contain no unapproved rows at
// all, so there is no filter to forget. This check exists to keep it that way
// — it fails if anything reaches for the RAW tables again, which is the only
// route back to the old hazard.
//
// Two files may: the ledger page is also the approval queue, and the form must
// be able to edit a proposal. Listed by name, so a third is a deliberate act.

import fs from 'fs'
import path from 'path'

const ALLOWED_UNFILTERED = new Set([
  // The ledger AND the approval queue: it has to see pending rows.
  'src/pages/Transactions.jsx',
  // Loads one transaction's lines for editing. Not an aggregation, and a
  // pending proposal must remain editable before it is decided.
  'src/components/TransactionForm.jsx',
])

const files = []
;(function walk(dir) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f)
    if (fs.statSync(p).isDirectory()) walk(p)
    else if (/\.jsx?$/.test(p)) files.push(p)
  }
})('src')

let problems = 0
let checked = 0

for (const file of files) {
  const src = fs.readFileSync(file, 'utf8')
  // each supabase read, up to the terminating .then / , / )
  const reads = src.matchAll(/supabase\s*\.?\s*from\('(transactions|transaction_lines)'\)\s*\.select\([\s\S]{0,400}?(?=\.then|\n\s*\)|,\n)/g)
  for (const m of reads) {
    checked++
    const chunk = m[0]
    if (!ALLOWED_UNFILTERED.has(file)) {
      problems++
      console.log(`  RAW TABLE READ  ${file}\n    ${chunk.slice(0, 120).replace(/\s+/g, ' ')}…`)
    }
  }
}

// writes are fine — the database trigger decides what a non-mentor may set
console.log(`\n  ${checked} raw-table reads found, ${problems} outside the allowed files`)
if (problems) {
  console.log('  Read ledger_transactions / ledger_lines_full instead — they')
  console.log('  cannot contain unapproved rows, so nothing has to be remembered.')
}
process.exit(problems ? 1 : 0)
