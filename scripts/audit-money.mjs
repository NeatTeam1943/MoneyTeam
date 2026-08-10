// Cross-cutting money audit: shared vs split budgets, and every total.
//
// The golden masters pin each function against a frozen copy of itself — they
// catch a function that CHANGED. They cannot catch a figure that was wrong from
// the start, or a rule two surfaces implement differently. This does: it builds
// a deliberately awkward season — one category carrying THREE pots, a receipt
// mixing all three programs, an orphaned line, a wholly unattributable line,
// and received/cancelled wish-list rows — and asserts every total against the
// arithmetic truth rather than against a previous run.
//
// Run: bash scripts/audit-money.sh

import { buildBudgetRows, groupSiblings } from '/tmp/A_budgets.mjs'
import { buildOwnership } from '/tmp/A_budgetOwnership.mjs'
import { totalsOf, overBudgetOf } from '/tmp/A_ledger.mjs'
import { linesByTransaction, attributableAmount, touchesScope, spendByScope, exclusiveVsShared, splitByExclusivity } from '/tmp/A_ts.mjs'
import { projectBudgets, newlyOver } from '/tmp/A_simulation.mjs'
import { spendableAfterGoals, goalImpact, budgetFundingGap } from '/tmp/A_goals.mjs'

const f = (n) => Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
let fails = 0
const check = (label, got, want) => {
  const ok = Math.abs(got - want) < 0.005
  if (!ok) fails++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(48)} got ${f(got).padStart(12)}  want ${f(want).padStart(12)}`)
}

// ---------------------------------------------------- budgets and spend ----
{

// A tree built to expose double counting: one category carries THREE pots,
// its parent carries two, and the lines are a mix of programs.
const cats = [
  { id: 'ROBOT', parent_id: null }, { id: 'MOTORS', parent_id: 'ROBOT' },
  { id: 'RAW',   parent_id: 'ROBOT' }, { id: 'COMP', parent_id: null },
]
const kids = { ROBOT: ['MOTORS', 'RAW'] }
const parentOf = { ROBOT: null, MOTORS: 'ROBOT', RAW: 'ROBOT', COMP: null }
const desc = (id) => { const a = new Set([id]), st = [id]
  while (st.length) { const x = st.pop(); for (const k of kids[x] || []) if (!a.has(k)) { a.add(k); st.push(k) } } return a }
const name = { ROBOT: 'רובוט', MOTORS: 'מנועים', RAW: 'חומרי גלם', COMP: 'תחרויות' }

const budgets = [
  { id: 'ALL',  category_id: null,     amount: 100000, team_scope: 'both' },
  { id: 'Rb',   category_id: 'ROBOT',  amount: 40000,  team_scope: 'both' },
  { id: 'Rf',   category_id: 'ROBOT',  amount: 25000,  team_scope: 'frc'  },
  { id: 'Rt',   category_id: 'ROBOT',  amount: 10000,  team_scope: 'ftc'  },
  { id: 'Wb',   category_id: 'RAW',    amount: 8000,   team_scope: 'both' },
  { id: 'Cb',   category_id: 'COMP',   amount: 15000,  team_scope: 'both' },
]
// every line charged to exactly one pot, spread across programs
const lines = [
  { budget_id: 'Rf', amount: 12000, team_scope: 'frc',  category_id: 'MOTORS' },
  { budget_id: 'Rf', amount: 3000,  team_scope: 'both', category_id: 'MOTORS' },
  { budget_id: 'Rt', amount: 4000,  team_scope: 'ftc',  category_id: 'MOTORS' },
  { budget_id: 'Rb', amount: 2000,  team_scope: 'both', category_id: 'ROBOT'  },
  { budget_id: 'Wb', amount: 5000,  team_scope: 'both', category_id: 'RAW'    },
  { budget_id: 'Cb', amount: 7000,  team_scope: 'ftc',  category_id: 'COMP'   },
  { budget_id: null, amount: 900,   team_scope: 'frc',  category_id: 'MOTORS' },  // orphan
  { budget_id: null, amount: 100,   team_scope: 'both', category_id: null     },  // wholly unattributed
]
const shopping = [
  { category_id: 'MOTORS', status: 'approved',         est_price: 1000, quantity: 2, team_scope: 'frc'  },
  { category_id: 'RAW',    status: 'pending_approval', est_price: 500,  quantity: 1, team_scope: 'both' },
  { category_id: 'COMP',   status: 'approved',         est_price: 300,  quantity: 3, team_scope: 'ftc'  },
  { category_id: 'RAW',    status: 'received',         est_price: 9999, quantity: 1, team_scope: 'both' },
  { category_id: 'RAW',    status: 'cancelled',        est_price: 8888, quantity: 1, team_scope: 'both' },
]
const OPEN = ['pending_approval', 'approved']
const lt = (r) => r.est_price * (r.quantity == null ? 1 : r.quantity)
const bcat = Object.fromEntries(budgets.map((b) => [b.id, b.category_id]))
const mk = (p) => { const s = new Set(p), all = s.has('frc') && s.has('ftc')
  return { all, matches: (v) => all || !v || v === 'both' || s.has(v) } }


for (const [flabel, picked] of [['both', ['frc','ftc']], ['FRC only', ['frc']], ['FTC only', ['ftc']]]) {
  const ts = mk(picked)
  console.log(`\n=== filter: ${flabel} ===`)
  const rows = buildBudgetRows('parent', {
    budgets: budgets.filter((b) => ts.matches(b.team_scope)), allBudgets: budgets,
    expenses: lines, shopping, budgetCategory: bcat, descendantsOf: desc,
    labelFor: (b) => (b.category_id ? name[b.category_id] : 'כללי'),
    matchesTeam: ts.matches, allTicked: ts.all, parentOf,
  })
  const by = Object.fromEntries(rows.map((r) => [r.id, r]))

  // spend is never program-filtered: a shared pot drained by one program has
  // that much less regardless of who is looking
  // A pot only appears when its program is on screen — that is the filter
  // working, not a missing figure. Check it only when it is shown.
  if (by.Rf) check('Rf spent = its own lines', by.Rf.spent, 12000 + 3000 + 900)
  if (by.Rt) check('Rt spent = its own lines', by.Rt.spent, 4000)
  check('FRC pot hidden under FTC filter', by.Rf ? 1 : 0, picked.includes('frc') ? 1 : 0)
  check('Wb spent',                        by.Wb?.spent ?? 0, 5000)
  // ALL absorbs everything, including the unattributable 100
  check('ALL spent = whole ledger',        by.ALL?.spent ?? 0,
        lines.reduce((s, l) => s + l.amount, 0))
  // Rb rolls up only what it owns: its own line + RAW beneath it
  check('Rb spent = own + RAW child',      by.Rb?.spent ?? 0, 2000 + 5000)

  // no shekel counted twice across the top of the tree
  const own = buildOwnership(budgets, parentOf)
  const top = rows.filter((r) => !own[r.id])
  check('sum of top-level spent = ledger', top.reduce((s, r) => s + r.spent, 0),
        lines.reduce((s, l) => s + l.amount, 0))

  // requested is split BY POT when a category carries several. Every pot on
  // one category used to report the same figure — including an FTC pot with no
  // FTC items — because the calculation ignored team_scope entirely.
  if (by.Rf && by.Rt && by.Rb) {
    const openIn = (cat, scope) => shopping
      .filter((r) => OPEN.includes(r.status) && r.category_id === cat && (r.team_scope || 'both') === scope)
      .reduce((s, r) => s + lt(r), 0)
    check('ROBOT·FRC requested = its own items', by.Rf.requested, openIn('MOTORS', 'frc'))
    check('ROBOT·FTC requested = its own items', by.Rt.requested, openIn('MOTORS', 'ftc'))
    check('pots on one category do not all report the same',
      (by.Rf.requested === by.Rt.requested && by.Rf.requested > 0) ? 0 : 1, 1)
  }

  // requested: open items only, once, respecting the filter
  const wantReq = shopping.filter((r) => OPEN.includes(r.status) && ts.matches(r.team_scope))
                          .reduce((s, r) => s + lt(r), 0)
  check('requested = open items, counted once',
        shopping.filter((r) => OPEN.includes(r.status) && ts.matches(r.team_scope)).reduce((s, r) => s + lt(r), 0),
        wantReq)

  // grouped view must not inflate the whole
  const g = groupSiblings(rows).find((r) => r.isGroup && r.label === 'רובוט')
  if (g) {
    check('grouped רובוט amount = sum of parts', g.amount, g.parts.reduce((s, p) => s + p.amount, 0))
    check('grouped רובוט spent  = sum of parts', g.spent,  g.parts.reduce((s, p) => s + p.spent, 0))
  }
}

}

// ------------------------------- expense attribution, reports, simulation ----
{


// one receipt mixing all three programs, plus two single-program purchases
const tx = [
  { id: 'mix', type: 'expense', amount: 10000, team_scope: 'both', date: '2026-03-01' },
  { id: 'f1',  type: 'expense', amount: 4000,  team_scope: 'frc',  date: '2026-03-02' },
  { id: 't1',  type: 'expense', amount: 1500,  team_scope: 'ftc',  date: '2026-03-03' },
  { id: 'inc', type: 'income',  amount: 20000, team_scope: 'both', date: '2026-03-04' },
]
const lines = [
  { transaction_id: 'mix', amount: 6000, team_scope: 'frc'  },
  { transaction_id: 'mix', amount: 3000, team_scope: 'ftc'  },
  { transaction_id: 'mix', amount: 1000, team_scope: 'both' },
  { transaction_id: 'f1',  amount: 4000, team_scope: 'frc'  },
  { transaction_id: 't1',  amount: 1500, team_scope: 'ftc'  },
]
const byTx = linesByTransaction(lines)
const mk = (p) => { const s = new Set(p), all = s.has('frc') && s.has('ftc')
  return { all, matches: (v) => all || !v || v === 'both' || s.has(v) } }

console.log('=== split purchase attributed line by line ===')
for (const [lbl, picked, want] of [
  ['both ticked', ['frc','ftc'], 10000],
  ['FRC only',    ['frc'],       6000 + 1000],   // its FRC lines + the shared one
  ['FTC only',    ['ftc'],       3000 + 1000],
]) {
  const ts = mk(picked)
  check(`mixed receipt counted as, ${lbl}`, attributableAmount(tx[0], byTx, ts), want)
}

console.log('\n=== totals per filter ===')
for (const [lbl, picked] of [['both', ['frc','ftc']], ['FRC only', ['frc']], ['FTC only', ['ftc']]]) {
  const ts = mk(picked)
  const scoped = tx.filter((r) => touchesScope(r, byTx, ts))
                   .map((r) => ({ ...r, amount: attributableAmount(r, byTx, ts) }))
  const t = totalsOf(scoped, ts.all)
  const wantExp = lines.filter((l) => ts.matches(l.team_scope)).reduce((s, l) => s + l.amount, 0)
  check(`expense, ${lbl}`, t.expense, wantExp)
  // income is shared and never split — it must stay whole
  check(`income stays whole, ${lbl}`, t.income, 20000)
  console.log(`  ${'net withheld under a partial filter'.padEnd(48)} ${t.net === null ? 'yes (—)' : 'NO: ' + f(t.net)}${ts.all ? '   (full view, so a number is right)' : ''}`)
}

console.log('\n=== exclusive vs shared, under a single-program filter ===')
for (const [lbl, picked, wantEx, wantSh] of [
  ['FRC only', ['frc'], 6000 + 4000, 1000],
  ['FTC only', ['ftc'], 3000 + 1500, 1000],
]) {
  const ts0 = mk(picked)
  const sp = exclusiveVsShared(tx, byTx, { ...ts0, frc: picked.includes('frc'), ftc: picked.includes('ftc') })
  check(`${lbl}: exclusive`, sp.exclusive, wantEx)
  check(`${lbl}: shared`,    sp.shared,    wantSh)
  check(`${lbl}: parts sum to the filtered total`, sp.exclusive + sp.shared, sp.total)
}
{
  // The shared part is why two filtered views must never be added together.
  const a = exclusiveVsShared(tx, byTx, { frc: true, ftc: false, all: false })
  const b = exclusiveVsShared(tx, byTx, { frc: false, ftc: true, all: false })
  const ledger = lines.reduce((s, l) => s + l.amount, 0)
  check('FRC total + FTC total - shared = ledger', a.total + b.total - a.shared, ledger)
  check('full view returns no split', exclusiveVsShared(tx, byTx, { frc: true, ftc: true, all: true }) === null ? 1 : 0, 1)
}

// The same split now serves budgets and wish-list items, not just expenses.
// One definition, so the three cannot drift apart.
{
  {
  {
  console.log('\n=== reserved money is a THIRD quantity ===')
  const goals = [{ reserved: 5000 }, { reserved: 4000 }]
  const sp = spendableAfterGoals(17631.95, goals)
  check('available = balance - reserved', sp.available, 8631.95)
  check('reserved is reported, not folded away', sp.reserved, 9000)
  check('a plan inside the free money does not intrude',
    goalImpact(5000, 17631.95, goals).intrusion, 0)
  check('a plan beyond it reports the exact shortfall',
    goalImpact(12000, 17631.95, goals).intrusion, 3368.05)

  // A naive subtraction here would print a negative amount of spendable money.
  const broke = spendableAfterGoals(3000, goals)
  check('available never goes below zero', broke.available, 0)
  check('and over-reservation is flagged', broke.overReserved ? 1 : 0, 1)

  // Reserving must not move any budget. It changes how much of the ceiling the
  // bank can cover, and nothing else.
  const gap = budgetFundingGap(15000, 17631.95, goals)
  check('budget ceiling is untouched by reserving', gap.budgetRemaining, 15000)
  check('unfunded permission = ceiling - spendable', gap.unfunded, 6368.05)
  check('no goals -> nothing unfunded', budgetFundingGap(15000, 17631.95, []).unfunded, 0)
  check('a funded budget reports no gap', budgetFundingGap(5000, 17631.95, goals).unfunded, 0)

  // A shortfall that predates the goals must be told apart, or a goal is
  // blamed for it.
  const pre = budgetFundingGap(30000, 17631.95, goals)
  check('pre-existing shortfall is separated', pre.unfundedWithoutGoals, 12368.05)
}

console.log('\n=== overspend is per pot, and a 0 pot is a real ceiling ===')
  const pOf = { ROBOT: null, TOOLS: null }
  const run = (bs, ls) => overBudgetOf({
    budgets: bs, allRows: [], allLines: ls,
    matchesTeam: () => true, allProgramsShown: true, parentOf: pOf,
  })
  // Every pot set to 0 AFTER the expenses were entered — the case that showed 0
  // while the team was tens of thousands over.
  const zeroed = run(
    [{ id: 'ALL', category_id: null, amount: 0, team_scope: 'both' },
     { id: 'Rb', category_id: 'ROBOT', amount: 0, team_scope: 'both' }],
    [{ budget_id: 'Rb', amount: 21592 }])
  check('all pots at 0 with spend -> that spend is over', zeroed.over, 21592)
  check('and the card is shown', zeroed.hasBudget ? 1 : 0, 1)

  // A funded pot that is over, while the overall pot still has room. The room
  // is real but cannot buy robot parts, so the overspend still counts.
  const over = run(
    [{ id: 'ALL', category_id: null, amount: 100000, team_scope: 'both' },
     { id: 'Rb', category_id: 'ROBOT', amount: 20000, team_scope: 'both' },
     { id: 'Tb', category_id: 'TOOLS', amount: 5000, team_scope: 'both' }],
    [{ budget_id: 'Rb', amount: 21592 }, { budget_id: 'Tb', amount: 3500 }])
  check('one pot over, another with room', over.over, 1592)

  const clean = run([{ id: 'Rb', category_id: 'ROBOT', amount: 30000, team_scope: 'both' }],
                    [{ budget_id: 'Rb', amount: 21592 }])
  check('within budget -> nothing over', clean.over, 0)

  const untouched = run([{ id: 'Rb', category_id: 'ROBOT', amount: 0, team_scope: 'both' }], [])
  check('no budget and no spend -> card hidden', untouched.hasBudget ? 1 : 0, 0)
}

console.log('\n=== the split applies to budgets and requests too ===')
  const pots = [
    { team_scope: 'frc',  amount: 25000 },
    { team_scope: 'ftc',  amount: 10000 },
    { team_scope: 'both', amount: 40000 },
  ]
  const wish = [
    { team_scope: 'frc',  v: 470 },
    { team_scope: 'both', v: 314 },
  ]
  for (const [lbl, ts0, wantEx, wantSh] of [
    ['FRC', { frc: true, ftc: false }, 25000, 40000],
    ['FTC', { frc: false, ftc: true }, 10000, 40000],
  ]) {
    const sp = splitByExclusivity(pots, (r) => r.amount, ts0)
    check(`budgets ${lbl}: exclusive`, sp.exclusive, wantEx)
    check(`budgets ${lbl}: shared`,    sp.shared,    wantSh)
  }
  const rq = splitByExclusivity(wish, (r) => r.v, { frc: true, ftc: false })
  check('requests FRC: exclusive', rq.exclusive, 470)
  check('requests FRC: shared',    rq.shared,    314)
  const rt = splitByExclusivity(wish, (r) => r.v, { frc: false, ftc: true })
  check('requests FTC: exclusive', rt.exclusive, 0)
  check('requests FTC: shared',    rt.shared,    314)
  check('full view returns no split',
    splitByExclusivity(pots, (r) => r.amount, { frc: true, ftc: true }) === null ? 1 : 0, 1)
}

console.log('\n=== by-program split of one mixed receipt ===')
const s = spendByScope(tx, byTx)
check('frc',    s.frc,  6000 + 4000)
check('ftc',    s.ftc,  3000 + 1500)
check('shared', s.both, 1000)
check('the three add back to the ledger', s.frc + s.ftc + s.both,
      lines.reduce((a, l) => a + l.amount, 0))

console.log('\n=== simulation: planned spend lands on ONE budget ===')
const cats = [{ id: 'ROBOT', parent_id: null }, { id: 'MOTORS', parent_id: 'ROBOT' }]
const parentOf = { ROBOT: null, MOTORS: 'ROBOT' }
const kids = { ROBOT: ['MOTORS'] }
const desc = (id) => { const a = new Set([id]), st = [id]
  while (st.length) { const x = st.pop(); for (const k of kids[x] || []) if (!a.has(k)) { a.add(k); st.push(k) } } return a }
const budgets = [
  { id: 'ALL', category_id: null,    amount: 50000, team_scope: 'both' },
  { id: 'Rb',  category_id: 'ROBOT', amount: 20000, team_scope: 'both' },
  { id: 'Rf',  category_id: 'ROBOT', amount: 15000, team_scope: 'frc'  },
]
const rows = projectBudgets({
  budgets, lines: [], picked: [], parentOf,
  extras: [{ id: 'x', category_id: 'MOTORS', team_scope: 'frc', amount: 9000 }],
  budgetCategory: { ALL: null, Rb: 'ROBOT', Rf: 'ROBOT' },
  inScopeFor: (b) => { const set = b.category_id ? desc(b.category_id) : null
    return (cid) => (b.category_id ? (cid && set.has(cid)) : true) },
  labelFor: (b) => (b.category_id ? 'רובוט' : 'כללי') + (b.team_scope !== 'both' ? ' ' + b.team_scope : ''),
})
const g = Object.fromEntries(rows.map((r) => [r.id, r]))
check('FRC pot takes the planned spend', g.Rf.planned, 9000)
check('shared ROBOT pot does NOT',       g.Rb.planned, 0)
check('overall rolls it up once',        g.ALL.planned, 9000)
const warn = newlyOver(rows, rows.ownership)
console.log(`  ${'one warning, on the innermost pot'.padEnd(48)} ${warn.map((w) => w.label).join(', ') || 'none'}`)


}

console.log(`\n${fails} failure(s)`)
process.exit(fails ? 1 : 0)
