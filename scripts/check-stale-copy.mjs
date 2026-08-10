// Strings that contradict what the code now does.
//
// Twice now a feature has shipped correctly while the sentence beside it still
// described the old behaviour — the unpriced-items hint told people their items
// were excluded, on a screen that had just been given a box to include them.
// A build check cannot judge wording in general, so this pins the specific
// claims that a code change would falsify.
import fs from 'fs'
const { readdirSync } = fs

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
const goalQueries = ['src/pages/Goals.jsx', 'src/pages/Dashboard.jsx',
  'src/pages/Reports.jsx', 'src/pages/Simulation.jsx']
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

let bad = seasonScoped
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

// A stat value must not carry an inline fontSize. Inline styles beat every
// stylesheet rule, so one `fontSize: 26` silently disabled all the responsive
// sizing — which is why the figures kept overflowing their cards on a phone no
// matter what the CSS said. It cost several rounds to find.
let inlineSize = 0
for (const f of readdirSync('src/pages').filter((x) => x.endsWith('.jsx'))) {
  const text = src(`src/pages/${f}`)
  for (const _m of text.matchAll(/className=[^>]{0,80}"v"[^>]{0,120}?fontSize:\s*\d+/g)) {
    inlineSize++
    console.log(`  INLINE fontSize on a stat value in src/pages/${f}`)
    console.log('         it overrides every responsive rule; size belongs in index.css')
  }
}

bad += inlineSize
console.log(bad ? `\n  ${bad} problem(s)` : '  no stale strings')
process.exit(bad ? 1 : 0)
