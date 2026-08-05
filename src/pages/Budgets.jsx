import { useEffect, useMemo, useState } from 'react'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts'
import { supabase, withTimeout } from '../lib/supabase'
import { useRefreshOnReturn } from '../lib/useRefreshOnReturn'
import { useAuth } from '../context/AuthContext'
import { useSeason } from '../context/SeasonContext'
import { useI18n } from '../lib/i18n'
import { useToast } from '../lib/toast'
import { useLookups } from '../lib/useLookups'
import { money } from '../lib/format'
import { buildBudgetRows, groupSiblings } from '../domain/budgets'
import { GROUPING, SCOPE } from '../domain/constants'
import { emptyCalcRow, rowTotal, calcTotal, cleanCalc, calcStatus } from '../domain/budgetCalc'
import Modal from '../components/Modal'
import { catLabel } from '../context/LookupsContext'
import { useTeamScope } from '../context/TeamScopeContext'
import { TeamScopeBadge, TeamScopePicker } from '../components/TeamScope'

const axis = { fontSize: 12, fill: '#4c5570', fontFamily: 'Space Mono, monospace' }
const tip = { background: '#fff', border: '1px solid #c6cde0', borderRadius: 8, fontSize: 13, color: '#151a2b' }

export default function Budgets() {
  const { t } = useI18n()
  const { canBudget, session } = useAuth()
  const uid = session?.user?.id
  const { activeId } = useSeason()
  const toast = useToast()
  const lk = useLookups()
  const ts = useTeamScope()
  const [budgets, setBudgets] = useState([])
  const [expenses, setExpenses] = useState([])
  const [shopping, setShopping] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)
  const [open, setOpen] = useState(false)

  async function load() {
    if (!activeId) { setLoading(false); return }
    if (budgets.length === 0) setLoading(true)   // only spinner when nothing is showing yet
    try {
      const [b, tl, sh] = await withTimeout(Promise.all([
        supabase.from('budgets').select('*').eq('season_id', activeId),
        supabase.from('ledger_lines_full').select('amount,budget_id,team_scope,category_id,season_id,tx_team_scope').eq('season_id', activeId),
        supabase.from('shopping_items').select('est_price,quantity,category_id,status,team_scope').eq('season_id', activeId),
      ]))
      if (!b.error) setBudgets(b.data || [])
      if (!tl.error) setExpenses(tl.data || []) // expense LINES (each charges a budget)
      if (!sh.error) setShopping(sh.data || [])
    } catch (e) {
      if (e.message === 'timeout') toast.error(t('loadTimedOut'))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    if (session?.user?.id) load()
    else setLoading(false)   // not signed in yet — don't sit on a spinner forever
  }, [activeId, uid])

  // Re-fetch on returning to the tab so a request Chrome dropped in the
  // background gets a fresh attempt — silent, since load() above won't show
  // a spinner while data is already on screen.
  useRefreshOnReturn(load, { enabled: !!(activeId && uid), deps: [activeId, uid] })

  // A budget now owns its program (migration 20), so the filter reads it
  // directly instead of guessing from the category.
  const scopedBudgets = useMemo(() => budgets.filter((b) => ts.matches(b.team_scope)), [budgets, ts])

  // Spend and requests are NOT filtered by the program checklist, and that is
  // the whole point. A shared pot consumed by FTC has less money left in it
  // whether or not you are currently looking at FTC — filtering the consumed
  // figure would show a remaining balance larger than the money that exists.
  // The checklist decides which budgets you SEE; never how full they are.
  const scopedExpenses = expenses
  const scopedShopping = shopping

  // Kept separately so a shared pot can show who consumed it, without that
  // split ever being mistaken for the total.
  const matchesTeam = (scope) => ts.matches(scope)

  // For each budget: spend + requested roll up over the category subtree.
  const budgetCat = useMemo(() => Object.fromEntries(budgets.map((b) => [b.id, b.category_id])), [budgets])
  // Same toggle as the Dashboard/Shopping charts — 'parent' (default) sums a
  // parent budget's children into it (e.g. תחרויות shows אוכל+הסעות+מדים
  // combined); 'direct' shows only spend charged to that exact budget's own
  // category, with nothing rolled up from children.
  const [categoryGrouping, setCategoryGrouping] = useState(GROUPING.PARENT)

  // The toggle belongs to the chart at the top and nothing else. The budget
  // cards below always show the canonical rolled-up figures, so flipping the
  // chart's view can never change what a card claims is spent or remaining.
  // The arithmetic lives in src/domain/budgets.js — pure, no React, and
  // exercised directly against production data by the golden-master harness.
  // This component's job is to say WHAT to render, not to work out the numbers.
  const buildRows = (grouping) => buildBudgetRows(grouping, {
    budgets: scopedBudgets,
    allBudgets: budgets,
    expenses: scopedExpenses,
    shopping: scopedShopping,
    budgetCategory: budgetCat,
    descendantsOf: lk.descendantsOf,
    labelFor: (b) => (!b.category_id ? t('overall') : (lk.categoryName[b.category_id] || t('uncategorized'))),
    matchesTeam,
    allTicked: ts.all,
    // Enables ownership-based attribution: a line counts against the budget it
    // was charged to, not against every budget sharing its category.
    parentOf: lk.parentOf,
  })

  // Cards: always 'parent' (the roll-up), independent of the chart toggle.
  const rows = useMemo(() => groupSiblings(buildRows(GROUPING.PARENT)),
    [scopedBudgets, scopedExpenses, scopedShopping, budgetCat, lk, t])          // eslint-disable-line react-hooks/exhaustive-deps
  // Chart: follows the toggle.
  const chartRows = useMemo(() => buildRows(categoryGrouping),
    [scopedBudgets, scopedExpenses, scopedShopping, budgetCat, lk, t, categoryGrouping])   // eslint-disable-line react-hooks/exhaustive-deps

  const chartData = useMemo(() => chartRows.map((r) => ({ name: r.team_scope === SCOPE.BOTH ? r.label : `${r.label} · ${r.team_scope.toUpperCase()}`, [t('spent')]: r.spent, [t('requested')]: r.requested })), [chartRows, t])

  async function del(id) {
    if (!confirm(t('confirmDelete'))) return
    await supabase.from('budgets').delete().eq('id', id)
    toast.success(t('deleted')); load()
  }

  const barColor = (pct) => (pct > 100 ? 'var(--danger)' : pct >= 80 ? 'var(--orange)' : 'var(--ok)')

  return (
    <div>
      {rows.length > 0 && (
        <div className="panel panel-pad" style={{ marginBottom: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <div className="section-title" style={{ marginTop: 0, marginBottom: 0 }}>{t('budgetVsRequested')}</div>
            <div className="tabs" style={{ marginBottom: 0 }}>
              <button className={'tab' + (categoryGrouping === 'direct' ? ' active' : '')} onClick={() => setCategoryGrouping('direct')}>{t('directOnly')}</button>
              <button className={'tab' + (categoryGrouping === 'parent' ? ' active' : '')} onClick={() => setCategoryGrouping('parent')}>{t('groupByParent')}</button>
            </div>
          </div>
          <div className="chart-box" style={{ direction: 'ltr' }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ left: 8, right: 8 }}>
                <CartesianGrid stroke="#dde2ee" vertical={false} />
                <XAxis dataKey="name" tick={axis} /><YAxis tick={axis} width={64} />
                <Tooltip contentStyle={tip} formatter={(v) => money(v)} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey={t('spent')} fill="#ff9100" radius={[3, 3, 0, 0]} />
                <Bar dataKey={t('requested')} fill="#1100ff" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {canBudget && (
        <div className="toolbar">
          <div className="spacer" />
          <button className="btn btn-primary" onClick={() => { setEditing(null); setOpen(true) }}>+ {t('setBudget')}</button>
        </div>
      )}

      {loading ? (
        <div className="panel empty">{t('loading')}</div>
      ) : rows.length ? (
        <div className="grid-2">
          {rows.map((r) => (
            <div key={r.id} className="panel panel-pad" style={r.childOver ? { borderColor: 'var(--danger)' } : undefined}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
                <h3 style={{ fontSize: 16, display: 'flex', alignItems: 'center', gap: 6 }}>
                  {r.label}{!r.isGroup && <TeamScopeBadge scope={r.team_scope} />}
                </h3>
                <span className="mono" style={{ color: 'var(--text-dim)', fontSize: 13 }}>{Math.round(r.pct)}%</span>
              </div>
              {r.childOver && <div style={{ color: 'var(--danger)', fontSize: 12, fontWeight: 700, marginBottom: 8 }}>{t('childrenExceedParent')}</div>}
              <div className="bar-track"><div className="bar-fill" style={{ width: Math.min(100, r.pct) + '%', background: barColor(r.pct) }} /></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12, fontSize: 13 }}>
                <span><span style={{ color: 'var(--text-faint)' }}>{t('spent')} </span><b className="mono">{money(r.spent)}</b></span>
                <span><span style={{ color: 'var(--text-faint)' }}>{t('budget')} </span><b className="mono">{money(r.amount)}</b></span>
                <span style={{ color: r.remaining < 0 ? 'var(--danger)' : 'var(--ok)' }}>{t('remaining')} <b className="mono">{money(r.remaining)}</b></span>
              </div>
              {/* A shared pot always reports its FULL consumption; this line
                  says how much of it came from the programs you are looking
                  at, so the split is visible without the balance ever being
                  understated. */}
              {/* A split pot: the whole above, each program underneath. */}
              {(() => {
                const st = calcStatus(r.amount, r.calc)
                if (!st.hasCalc) return null
                return (
                  <details style={{ marginTop: 6 }}>
                    <summary style={{ fontSize: 12, color: 'var(--text-faint)', cursor: 'pointer' }}>
                      {t('budgetCalc')}
                      {!st.matches && <b style={{ color: 'var(--orange)' }}> · {t('calcDiffers')}</b>}
                    </summary>
                    <table className="data" style={{ marginTop: 4 }}>
                      <tbody>
                        {r.calc.map((c, i) => (
                          <tr key={i}>
                            <td style={{ fontSize: 12 }}>{c.label || '—'}</td>
                            <td className="num mono" style={{ fontSize: 12 }}>{c.qty} × {money(c.unit)}</td>
                            <td className="num mono" style={{ fontSize: 12 }}>{money(rowTotal(c))}</td>
                          </tr>
                        ))}
                        <tr>
                          <td colSpan={2} style={{ fontSize: 12, fontWeight: 700 }}>{t('total')}</td>
                          <td className="num mono" style={{ fontSize: 12, fontWeight: 700 }}>{money(st.total)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </details>
                )
              })()}
              {r.parts && (
                <div style={{ marginTop: 8, borderTop: '1px solid var(--line)', paddingTop: 6 }}>
                  {r.parts.map((p) => (
                    <div key={p.id} style={{
                      display: 'flex', justifyContent: 'space-between', gap: 8,
                      fontSize: 12, padding: '3px 0', flexWrap: 'wrap',
                    }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                        <span style={{ color: 'var(--text-faint)' }}>└</span>
                        <TeamScopeBadge scope={p.team_scope} />
                      </span>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span className="mono" style={{ color: 'var(--text-dim)' }}>
                          {money(p.spent)} / {money(p.amount)}
                          {p.amount > 0 && p.spent > p.amount &&
                            <b style={{ color: 'var(--danger)' }}> · {t('over')}</b>}
                        </span>
                        {/* Each part is a real budget with its own id. The
                            group row above is a synthetic total and must not
                            offer edit or delete — acting on it would target a
                            budget that does not exist and carry the summed
                            amount of all three. */}
                        {canBudget && (
                          <span style={{ display: 'inline-flex', gap: 2 }}>
                            <button className="btn btn-ghost btn-sm" style={{ padding: '1px 6px', fontSize: 11 }}
                              onClick={() => { setEditing(p); setOpen(true) }}>{t('edit')}</button>
                            <button className="btn btn-ghost btn-sm btn-danger" style={{ padding: '1px 6px', fontSize: 11 }}
                              onClick={() => del(p.id)}>{t('delete')}</button>
                          </span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {!r.isGroup && r.team_scope === SCOPE.BOTH && r.spentInScope !== r.spent && (
                <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text-faint)' }}>
                  {t('sharedPotNote').replace('{v}', money(r.spentInScope))}
                </div>
              )}
              {canBudget && (
                <div style={{ marginTop: 12, display: 'flex', gap: 6 }}>
                  {r.isGroup ? (
                    <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>{t('editEachPart')}</span>
                  ) : (<>
                    <button className="btn btn-ghost btn-sm" onClick={() => { setEditing(r); setOpen(true) }}>{t('edit')}</button>
                    <button className="btn btn-ghost btn-sm btn-danger" onClick={() => del(r.id)}>{t('delete')}</button>
                  </>)}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="panel empty-cta">
          <p>{t('noBudgetsYet')}</p>
          {canBudget && <button className="btn btn-primary" onClick={() => { setEditing(null); setOpen(true) }}>+ {t('addFirst')}</button>}
        </div>
      )}

      {open && (
        <BudgetForm
          editing={editing} seasonId={activeId} categoryTree={lk.categoryTree} existing={budgets}
          onClose={() => setOpen(false)} onSaved={() => { setOpen(false); toast.success(t('saved')); load() }}
        />
      )}
    </div>
  )
}

function BudgetForm({ editing, seasonId, categoryTree, existing, onClose, onSaved }) {
  const { t } = useI18n()
  const [categoryId, setCategoryId] = useState(editing?.category_id || '')
  const [amount, setAmount] = useState(editing?.amount || '')
  const [teamScope, setTeamScope] = useState(editing?.team_scope || 'both')
  const [calc, setCalc] = useState(() => (editing?.calc?.length ? editing.calc : [emptyCalcRow()]))
  const calcSum = calcTotal(calc)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  // One pot per category PER PROGRAM now, so the "already taken" test has to
  // include the program or it would block a legitimate second budget.
  const taken = new Set(existing.filter((b) => b.id !== editing?.id)
    .map((b) => `${b.category_id || '__overall__'}|${b.team_scope || 'both'}`))

  async function save() {
    if (!(Number(amount) >= 0)) { setErr(t('requiredField') + ': ' + t('amount')); return }
    setErr(''); setBusy(true)
    const payload = { season_id: seasonId, category_id: categoryId || null, amount: Number(amount), team_scope: teamScope, calc: cleanCalc(calc) }
    const res = editing
      ? await supabase.from('budgets').update(payload).eq('id', editing.id)
      : await supabase.from('budgets').insert(payload)
    setBusy(false)
    if (res.error) { setErr(res.error.message); return }
    onSaved()
  }

  return (
    <Modal
      title={t('setBudget')} onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>{t('cancel')}</button>
        <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? '…' : t('save')}</button>
      </>}
    >
      {/* The working behind the figure. Filling it in is optional; the amount
          stays authoritative either way, which is why "החל" is a button and
          not automatic — rounding a total up is a decision, not a mistake. */}
      <div className="field">
        <label>{t('budgetCalc')}</label>
        <p style={{ color: 'var(--text-faint)', fontSize: 12, margin: '0 0 6px' }}>{t('budgetCalcHint')}</p>
        {calc.map((r, i) => (
          <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <input placeholder={t('description')} value={r.label} style={{ flex: '2 1 10rem' }}
              onChange={(e) => setCalc(calc.map((x, ix) => (ix === i ? { ...x, label: e.target.value } : x)))} />
            <input type="number" step="any" placeholder={t('quantity')} value={r.qty} style={{ flex: '1 1 5rem' }}
              onChange={(e) => setCalc(calc.map((x, ix) => (ix === i ? { ...x, qty: e.target.value } : x)))} />
            <span style={{ color: 'var(--text-faint)' }}>×</span>
            <input type="number" step="any" placeholder="₪" value={r.unit} style={{ flex: '1 1 5rem' }}
              onChange={(e) => setCalc(calc.map((x, ix) => (ix === i ? { ...x, unit: e.target.value } : x)))} />
            <span className="mono" style={{ flex: '0 0 6rem', textAlign: 'end', color: 'var(--text-dim)' }}>
              {money(rowTotal(r))}
            </span>
            {calc.length > 1 && (
              <button type="button" className="btn btn-ghost btn-sm btn-danger"
                onClick={() => setCalc(calc.filter((_, ix) => ix !== i))}>✕</button>
            )}
          </div>
        ))}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-sm" onClick={() => setCalc([...calc, emptyCalcRow()])}>
            + {t('addRow')}
          </button>
          {calcSum > 0 && (
            <>
              <b className="mono">{t('total')}: {money(calcSum)}</b>
              <button type="button" className="btn btn-sm" onClick={() => setAmount(String(calcSum))}>
                {t('applyToAmount')}
              </button>
            </>
          )}
        </div>
      </div>

      <div className="field">
        <label>{t('teamScope')}</label>
        <TeamScopePicker value={teamScope} onChange={setTeamScope} />
        <p style={{ color: 'var(--text-faint)', fontSize: 12, margin: '4px 0 0' }}>{t('budgetScopeHint')}</p>
      </div>

      <div className="field">
        <label>{t('category')}</label>
        <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} disabled={!!editing}>
          <option value="" disabled={taken.has(`__overall__|${teamScope}`)}>{t('overall')}</option>
          {categoryTree.map((c) => (
            <option key={c.id} value={c.id} disabled={taken.has(`${c.id}|${teamScope}`)}>{catLabel(c)}</option>
          ))}
        </select>
        {categoryTree.length === 0 && <p style={{ color: 'var(--text-faint)', fontSize: 12, marginTop: 6 }}>{t('noCategoriesHint')}</p>}
      </div>
      <div className="field">
        <label>{t('budget')} (₪)</label>
        <input type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </div>
      {err && <div className="err">{err}</div>}
    </Modal>
  )
}
