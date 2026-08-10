// Strings that contradict what the code now does.
//
// Twice now a feature has shipped correctly while the sentence beside it still
// described the old behaviour — the unpriced-items hint told people their items
// were excluded, on a screen that had just been given a box to include them.
// A build check cannot judge wording in general, so this pins the specific
// claims that a code change would falsify.
import fs from 'fs'

const i18n = fs.readFileSync('src/lib/i18n.jsx', 'utf8')
const src = (p) => fs.readFileSync(p, 'utf8')

const rules = [
  {
    key: 'unpricedExcluded',
    // The claim is only honest if there is NO way to price an item in place.
    falsifiedBy: () => /guessPrice\[r\.id\] \?\?/.test(src('src/pages/Simulation.jsx')),
    says: /לא נכללים|are excluded/,
    why: 'the simulation lets an estimate be typed, so unpriced items CAN be included',
  },
]

// Goals are not season-scoped. Filtering them by season made a goal disappear
// when the season picker moved while the money it reserved was still held, and
// re-creating it per season reserved the same shekel twice. Cheap to reintroduce
// by copying a nearby query, so it is asserted rather than remembered.
// Discovered, not listed. I hard-coded four files, then added a goals query to
// Budgets.jsx and forgot to update the list — so the check passed on a file it
// was never looking at, which is the failure mode a check is supposed to remove.
const goalQueries = fs.readdirSync('src/pages')
  .filter((f) => f.endsWith('.jsx'))
  .map((f) => `src/pages/${f}`)
  .filter((p) => src(p).includes("savings_goals"))
let seasonScoped = 0
for (const p of goalQueries) {
  const text = src(p)
  const re = /savings_goals'\)[^\n]*\.eq\('season_id'/g
  for (const m of text.matchAll(re)) {
    seasonScoped++
    console.log(`  SEASON-SCOPED GOAL QUERY in ${p}`)
    console.log('         goals span seasons; filtering by season hides live reservations')
  }
}

// A column added by a migration must not be named in a select list: if that
// migration has not run, the WHOLE query fails and the feature vanishes with no
// error on screen. `select('*')` degrades instead — the field is simply
// undefined, which the code already handles.
const lateColumns = ['archived_at']
let lateColumnUse = 0
for (const p of goalQueries) {
  // Any select list on savings_goals, then look inside it for a late column.
  for (const m of src(p).matchAll(/savings_goals'\)\s*\.select\('([^']*)'/g)) {
    const list = m[1]
    if (list.trim() === '*') continue
    for (const col of lateColumns) {
      if (list.includes(col)) {
        lateColumnUse++
        console.log(`  LATE COLUMN in a select list: ${col} in ${p}`)
        console.log('         naming it fails the whole query on a database that')
        console.log("         has not run the migration; use select('*') instead")
      }
    }
  }
}

let bad = seasonScoped + lateColumnUse
for (const r of rules) {
  const m = [...i18n.matchAll(new RegExp(`${r.key}: '([^']*)'`, 'g'))].map((x) => x[1])
  if (!m.length) continue
  if (!r.falsifiedBy()) continue
  for (const text of m) {
    if (r.says.test(text)) {
      bad++
      console.log(`  STALE  ${r.key}: "${text}"`)
      console.log(`         ${r.why}`)
    }
  }
}
console.log(bad ? `\n  ${bad} stale string(s)` : '  no stale strings')
process.exit(bad ? 1 : 0)
