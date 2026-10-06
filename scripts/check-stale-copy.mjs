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

// A budget lock freezes the AMOUNT. It must never reach the spending path:
// "we have decided the budget" is not "no more spending" — it is the point at
// which the budget starts doing its job. Cheap to break by adding a
// `budgets_locked` check to the wrong screen, so it is asserted.
let lockLeak = 0
const spendPaths = ['src/pages/Transactions.jsx', 'src/pages/Shopping.jsx',
  'src/pages/Simulation.jsx', 'src/pages/Dashboard.jsx', 'src/pages/Reports.jsx',
  'src/components/TransactionForm.jsx']
for (const p of spendPaths) {
  let text
  try { text = src(p) } catch { continue }
  if (text.includes('budgets_locked')) {
    lockLeak++
    console.log(`  LOCK LEAKED INTO THE SPENDING PATH: ${p}`)
    console.log('         a lock freezes budget amounts, not spending or reporting')
  }
}

// An export must not carry a field the screen hides from that reader. The
// database masks payer_display to '***' for non-mentors, so this one is about
// noise rather than a leak — but the same pattern with an UNMASKED field would
// be a real leak, and this is the place to catch it.
let unguardedPayer = 0
for (const _m of src('src/lib/export.js').matchAll(/^\s*Payer:/gm)) {
  unguardedPayer++
  console.log('  UNGUARDED Payer COLUMN in src/lib/export.js')
  console.log('         gate it on meta.canSeePayer — the screen hides it from non-mentors')
}

// Pages a guest can reach must not query member-only tables unbranched. A
// guest is the `anon` role and PostgREST answers 401 — which shows up as an
// empty page, not an error, so it is invisible without opening the network
// tab. That is exactly how the guest budgets page stayed broken through
// three rounds of looking in the wrong place.
const GUEST_PAGES = ['src/pages/Dashboard.jsx', 'src/pages/Transactions.jsx',
  'src/pages/Budgets.jsx']
const MEMBER_ONLY = ['budgets', 'transaction_lines', 'ledger_lines_full',
  'shopping_items', 'savings_goals', 'active_goals']
let unbranched = 0
for (const p of GUEST_PAGES) {
  let text
  try { text = src(p) } catch { continue }
  const lines = text.split('\n')
  // Everything after an `if (isParent) return` is already unreachable for a
  // guest. Without tracking that, the check flags correct code — which is
  // worse than not checking, because a noisy check gets ignored.
  const earlyReturn = lines.findIndex((l) => /if \(isParent\)\s*return/.test(l))
  const cutoff = earlyReturn === -1 ? Infinity : earlyReturn

  for (let i = 0; i < lines.length; i++) {
    if (i > cutoff) break
    const line = lines[i]
    const m = line.match(/from\('([a-z_]+)'\)/)
    if (!m || !MEMBER_ONLY.includes(m[1])) continue
    // Branched if isParent is on the same line (a ternary), the line is the
    // else-half of one, or a guard opened just above it.
    if (/isParent/.test(line) || /^\s*:/.test(line)) continue
    if (lines.slice(Math.max(0, i - 3), i).some((l) => /if \(!isParent\)/.test(l))) continue
    unbranched++
    console.log(`  UNBRANCHED ${m[1]} QUERY in ${p}`)
    console.log('         a guest is anon and gets 401 — branch it to the _guest view')
  }
}

// A guest has no session, so a page keyed on `session.user.id` alone never
// loads for them — it renders empty with no error anywhere, which is exactly
// how the budgets page looked correct in the network tab and blank on screen.
// The two pages that always worked derive uid with a 'guest' fallback; any
// guest-reachable page must do the same.
let bareUid = 0
for (const p of GUEST_PAGES) {
  let text
  try { text = src(p) } catch { continue }
  const m = text.match(/const uid = [^\n]+/)
  if (m && !/isParent/.test(m[0])) {
    bareUid++
    console.log(`  uid WITHOUT A GUEST FALLBACK in ${p}`)
    console.log("         use: session?.user?.id || (isParent ? 'guest' : null)")
  }
}


// Shopping statuses live in ONE list. Three files had grown their own copy of
// ['pending_approval', 'approved', ...] — the form's dropdown, the page's
// filter, and the budget roll-up — so adding a status to the enum left it
// absent from two dropdowns and uncounted in the funding gap, with nothing
// failing. Adding a status is rare enough that the next person will not
// remember where the copies are, so the copies are not allowed.
//
// Only the four values NOTHING ELSE uses are matched. 'approved', 'pending',
// 'received' and 'cancelled' are also budget-raise and transaction-approval
// states, and matching those flagged six correct lines on the first run — a
// check that fires on correct code gets ignored, which is worse than no check.
// Any copy of the full list necessarily contains 'pending_approval' and
// 'ordered', so the narrow rule still catches the thing worth catching.
const STATUS_LITERALS = /'(wish|pending_approval|waiting_finance|waiting_sponsor|ordered)'/
let statusCopy = 0
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? walk(`${dir}/${e.name}`)
    : /\.jsx?$/.test(e.name) ? [`${dir}/${e.name}`] : [])
for (const f of walk('src')) {
  if (f === 'src/domain/constants.js' || f === 'src/lib/i18n.jsx') continue
  const lines = src(f).split('\n')
  for (let i = 0; i < lines.length; i++) {
    // A status named in a comment is prose, not a second source of truth —
    // and one of them explains why the literal is absent from the code below.
    const code = lines[i].replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '')
    if (!STATUS_LITERALS.test(code)) continue
    statusCopy++
    console.log(`  HARD-CODED SHOPPING STATUS in ${f}:${i + 1}`)
    console.log('         use SHOPPING_STATUS / SELECTABLE_STATUSES / BUYABLE_STATUSES / OPEN_STATUSES')
  }
}


// A custom property that is used but never defined. CSS does not warn: the
// declaration is simply invalid at computed-value time, so the property falls
// back to its initial value — `background: var(--brand)` becomes transparent.
// That is how the calculator button shipped as a white glyph on a white page,
// and how the = key disappeared from the keypad in the light theme, with the
// build, the lint and every other check passing. A fallback — var(--x, #fff)
// — is safe and is not flagged.
const css = src('src/index.css')
//
// Definitions are read from :root ONLY, not from the whole file. A variable
// defined solely inside [data-theme="neat"] is undefined in the light theme —
// which is the same white-on-white failure, visible in one theme and not the
// other. Taking any definition anywhere let exactly that case through: it
// reported a pass with --on-orange deleted from :root and left in the dark
// block. The theme block is for OVERRIDES; the base must carry every name.
const rootBlock = css.slice(css.indexOf(':root {'), css.indexOf('}', css.indexOf(':root {')))
const defined = new Set([...rootBlock.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]))
// Names the dark theme adds on top. Legitimate inside a rule that only
// applies when that theme is on — --blue-text is exactly that, and flagging
// it would be flagging correct code.
const themed = new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]))
let undef = 0
const seen = new Set()
for (const f of ['src/index.css', ...walk('src')]) {
  const lines = src(f).replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' ')).split('\n')
  for (let i = 0; i < lines.length; i++) {
    // A variable NAMED in a comment is prose — including the comment that
    // explains why a broken one was removed.
    const code = lines[i].replace(/\/\/.*$/, '')
    // Which selector is this line inside? Walk back to the nearest `{`,
    // taking two lines above it as well so a multi-line selector list is
    // read whole.
    let sel = ''
    for (let j = i; j >= 0; j--) {
      if (lines[j].includes('{')) { sel = lines.slice(Math.max(0, j - 2), j + 1).join(' '); break }
    }
    const inThemedRule = sel.includes('[data-theme=')
    const ok = inThemedRule ? themed : defined
    for (const m of code.matchAll(/var\((--[a-z0-9-]+)\s*\)/g)) {
      if (ok.has(m[1]) || seen.has(m[1] + f)) continue
      seen.add(m[1] + f)
      undef++
      console.log(`  UNDEFINED CSS VARIABLE ${m[1]} in ${f}:${i + 1}`)
      console.log('         nothing defines it — the declaration is dropped and the value falls back')
    }
  }
}


// The finance lead's rule is written twice: in guard_shopping_status()
// (migration 51), which is the boundary, and in domain/constants.js, which
// decides what the UI offers. They have to agree. If the SQL is stricter you
// get buttons the database refuses; if the JS is stricter you get a quiet hole
// where the UI is the only thing stopping someone, and this app sends PATCHes
// straight to PostgREST.
const sql = (() => { try { return src('51_finance_lead.sql') } catch { return '' } })()
let ruleDrift = 0
if (sql) {
  const consts = src('src/domain/constants.js')
  // SHOPPING_STATUS.X -> its string value, so the JS lists can be compared
  // against the literals the SQL uses.
  const values = Object.fromEntries(
    [...consts.matchAll(/^\s*([A-Z_]+):\s*'([a-z_]+)',/gm)].map((m) => [m[1], m[2]]))
  const jsList = (name) => {
    const at = consts.indexOf(`export const ${name} = Object.freeze([`)
    if (at === -1) return null
    const body = consts.slice(at, consts.indexOf('])', at))
    return [...body.matchAll(/SHOPPING_STATUS\.([A-Z_]+)/g)].map((m) => values[m[1]]).sort()
  }
  const sqlList = (re) => {
    const m = sql.match(re)
    return m ? [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort() : null
  }
  const pairs = [
    ['FINANCE_LEAD_STATUSES', /new\.status not in \(([^)]*)\)/, 'what a finance lead may set'],
    ['MENTOR_DECIDED_STATUSES', /old\.status in \(([^)]*)\)/, 'what locks a row against them'],
  ]
  for (const [name, re, what] of pairs) {
    const a = jsList(name)
    const b = sqlList(re)
    if (!a || !b) {
      ruleDrift++
      console.log(`  CANNOT COMPARE ${name} WITH 51_finance_lead.sql`)
      console.log('         one of the two lists could not be read — check the names still match')
      continue
    }
    if (a.join(',') !== b.join(',')) {
      ruleDrift++
      console.log(`  ${name} DISAGREES WITH THE TRIGGER (${what})`)
      console.log(`         constants.js: ${a.join(', ')}`)
      console.log(`         migration 51: ${b.join(', ')}`)
    }
  }
}

bad += inlineSize + lockLeak + unguardedPayer + unbranched + bareUid + statusCopy + undef + ruleDrift
console.log(bad ? `\n  ${bad} problem(s)` : '  no stale strings')
process.exit(bad ? 1 : 0)
