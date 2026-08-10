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

let bad = 0
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
