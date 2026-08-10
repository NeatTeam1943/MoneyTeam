import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useSeason } from '../context/SeasonContext'
import { useLookups } from '../lib/useLookups'
import { useTeamScope } from '../context/TeamScopeContext'
import { useI18n } from '../lib/i18n'
import { money } from '../lib/format'
import { goalProgress, goalsSummary, daysUntil } from '../domain/goals'
import { TeamScopeBadge, TeamScopePicker } from '../components/TeamScope'
import Modal from '../components/Modal'
import DateField from '../components/DateField'
import { useRefreshOnReturn } from '../lib/useRefreshOnReturn'

export default function Goals() {
  const { t } = useI18n()
  const { activeId } = useSeason()
  const { session, isMentor, canPropose } = useAuth()
  const lk = useLookups()
  const ts = useTeamScope()
  const uid = session?.user?.id

  const [goals, setGoals] = useState([])
  const [balances, setBalances] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)
  const [showForm, setShowForm] = useState(false)

  const load = async () => {
    if (!activeId || !uid) return
    const [g, b] = await Promise.all([
      supabase.from('savings_goals').select('*').eq('season_id', activeId).order('target_date', { nullsFirst: false }),
      supabase.from('account_balances').select('*'),
    ])
    if (!g.error) setGoals(g.data || [])
    if (!b.error) setBalances(b.data || [])
    setLoading(false)
  }
  useEffect(() => { load() /* eslint-disable-line react-hooks/exhaustive-deps */ }, [activeId, uid])
  useRefreshOnReturn(load, { enabled: !!(activeId && uid), deps: [activeId, uid] })

  // What actually exists to reserve against.
  const cash = useMemo(
    () => balances.reduce((s, b) => s + (Number(b.balance) || 0), 0), [balances])

  const shown = useMemo(() => goals.filter((g) => ts.matches(g.team_scope)), [goals, ts])
  const summary = useMemo(() => goalsSummary(shown, cash), [shown, cash])

  const remove = async (g) => {
    if (!window.confirm(t('confirmDelete'))) return
    await supabase.from('savings_goals').delete().eq('id', g.id)
    load()
  }

  if (loading) return <div className="empty">{t('loading')}</div>

  return (
    <div>
      <p style={{ color: 'var(--text-faint)', fontSize: 13, marginTop: 0 }}>{t('goalsHint')}</p>

      <div className="stats" style={{ marginBottom: 18 }}>
        <Stat k={t('moneyAvailable')} v={money(cash)} />
        <Stat k={t('totalReserved')} v={money(summary.reserved)} c="var(--text-dim)" />
        <Stat k={t('unreserved')} v={money(summary.unreserved)} c="var(--ok)" />
        <Stat k={t('stillNeeded')} v={money(summary.stillNeeded)} c="var(--out)" />
      </div>

      {/* The failure a per-goal view cannot show: each goal looks fine on its
          own while the goals together promise money that is not there. */}
      {summary.overCommitted > 0 && (
        <div className="panel panel-pad" style={{
          marginBottom: 18, borderInlineStart: '3px solid var(--danger)',
        }}>
          <b style={{ color: 'var(--danger)' }}>{t('overCommitted')}</b>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-dim)' }}>
            {t('overCommittedHint').replace('{v}', money(summary.overCommitted))}
          </p>
        </div>
      )}

      {canPropose && (
        <button className="btn btn-primary" style={{ marginBottom: 14 }}
          onClick={() => { setEditing(null); setShowForm(true) }}>
          + {t('addGoal')}
        </button>
      )}

      {!shown.length && <div className="empty">{t('noGoals')}</div>}

      <div className="charts">
        {shown.map((g) => {
          const p = goalProgress(g, cash)
          const days = daysUntil(g.target_date)
          return (
            <div key={g.id} className="panel panel-pad">
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
                <b>{g.name}</b>
                <TeamScopeBadge scope={g.team_scope} />
              </div>

              <div className="bar-track" style={{ margin: '10px 0 6px' }}>
                <div className="bar-fill" style={{
                  width: `${Math.min(100, p.pct)}%`,
                  background: p.met ? 'var(--ok)' : 'var(--orange)',
                }} />
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, flexWrap: 'wrap', gap: 6 }}>
                <span className="mono">{money(p.funded)} / {money(p.target)}</span>
                <span className="mono" style={{ color: p.met ? 'var(--ok)' : 'var(--text-dim)' }}>
                  {Math.round(p.pct)}%
                </span>
              </div>

              {!p.met && (
                <div style={{ fontSize: 13, color: 'var(--text-dim)', marginTop: 4 }}>
                  {t('shortBy')}: <span className="mono">{money(p.short)}</span>
                </div>
              )}

              {/* A deadline is only useful with the arithmetic attached. */}
              {days != null && !p.met && (
                <div style={{ fontSize: 12, color: days < 0 ? 'var(--danger)' : 'var(--text-faint)', marginTop: 4 }}>
                  {days < 0
                    ? t('goalOverdue').replace('{n}', Math.abs(days))
                    : t('goalDue').replace('{n}', days)
                      + (days > 0 ? ` · ${t('perWeek').replace('{v}', money(p.short / Math.max(1, days / 7)))}` : '')}
                </div>
              )}

              {p.overReserved && (
                <div style={{ fontSize: 12, color: 'var(--danger)', marginTop: 4 }}>{t('reservedBeyondCash')}</div>
              )}

              {g.notes && (
                <p style={{ fontSize: 12, color: 'var(--text-faint)', margin: '8px 0 0', whiteSpace: 'pre-wrap' }}>{g.notes}</p>
              )}

              {isMentor && (
                <div style={{ marginTop: 10, display: 'flex', gap: 6 }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => { setEditing(g); setShowForm(true) }}>{t('edit')}</button>
                  <button className="btn btn-ghost btn-sm btn-danger" onClick={() => remove(g)}>{t('delete')}</button>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {showForm && (
        <GoalForm
          editing={editing}
          seasonId={activeId}
          categories={lk.categoryTree}
          canSetReserved={isMentor}
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); load() }}
        />
      )}
    </div>
  )
}

function Stat({ k, v, c }) {
  return (
    <div className="panel stat">
      <div className="k">{k}</div>
      <div className="v" style={{ color: c || 'var(--text)' }}>{v}</div>
    </div>
  )
}

function GoalForm({ editing, seasonId, categories, canSetReserved, onClose, onSaved }) {
  const { t } = useI18n()
  const [f, setF] = useState(() => ({
    name: editing?.name || '',
    target: editing?.target ?? '',
    target_date: editing?.target_date || '',
    category_id: editing?.category_id || '',
    team_scope: editing?.team_scope || 'both',
    reserved: editing?.reserved ?? 0,
    notes: editing?.notes || '',
  }))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })

  const save = async () => {
    if (!f.name.trim()) { setErr(t('nameRequired')); return }
    if (!(Number(f.target) > 0)) { setErr(t('targetRequired')); return }
    setBusy(true); setErr('')
    const payload = {
      season_id: seasonId,
      name: f.name.trim(),
      target: Number(f.target),
      target_date: f.target_date || null,
      category_id: f.category_id || null,
      team_scope: f.team_scope,
      notes: f.notes || null,
      // Only a mentor may move reserved money; for anyone else it keeps its
      // current value rather than being silently reset to 0.
      ...(canSetReserved ? { reserved: Number(f.reserved) || 0 } : {}),
    }
    const res = editing
      ? await supabase.from('savings_goals').update(payload).eq('id', editing.id)
      : await supabase.from('savings_goals').insert(payload)
    setBusy(false)
    if (res.error) { setErr(res.error.message); return }
    onSaved()
  }

  return (
    <Modal title={editing ? t('editGoal') : t('addGoal')} onClose={onClose} footer={
      <>
        <button className="btn btn-ghost" onClick={onClose}>{t('cancel')}</button>
        <button className="btn btn-primary" onClick={save} disabled={busy}>{t('save')}</button>
      </>
    }>
      {err && <div className="empty" style={{ color: 'var(--danger)' }}>{err}</div>}
      <div className="field"><label>{t('name')} *</label>
        <input value={f.name} onChange={set('name')} /></div>
      <div className="grid-2">
        <div className="field"><label>{t('target')} (₪) *</label>
          <input type="number" step="0.01" value={f.target} onChange={set('target')} /></div>
        <div className="field"><label>{t('targetDate')}</label>
          <DateField value={f.target_date} onChange={set('target_date')} /></div>
      </div>
      {canSetReserved && (
        <div className="field">
          <label>{t('reserved')} (₪)</label>
          <input type="number" step="0.01" value={f.reserved} onChange={set('reserved')} />
          <p style={{ fontSize: 12, color: 'var(--text-faint)', margin: '4px 0 0' }}>{t('reservedHint')}</p>
        </div>
      )}
      <div className="field"><label>{t('teamScope')}</label>
        <TeamScopePicker value={f.team_scope} onChange={(v) => setF({ ...f, team_scope: v })} /></div>
      <div className="field"><label>{t('category')}</label>
        <select value={f.category_id} onChange={set('category_id')}>
          <option value="">—</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.path || c.name}</option>)}
        </select></div>
      <div className="field"><label>{t('notes')}</label>
        <textarea rows={3} value={f.notes} onChange={set('notes')} /></div>
    </Modal>
  )
}
