import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useI18n } from '../lib/i18n'
import { fmtDate, money } from '../lib/format'
import { reapply, snapshotTotal } from '../domain/simSnapshot'

/**
 * Saving, reopening and sharing a scenario.
 *
 * Only the TYPED parts are saved — ad-hoc rows, expected income, the default
 * account. The shopping-list picks are not, because they reference rows that
 * move: an item gets bought, a price is filled in, someone deletes it. A saved
 * scenario pointing at them would reopen showing a different total with nothing
 * to say why, which is worse than not offering to save it at all.
 *
 * So reopening restores the thinking and starts fresh on the list.
 */
export default function SavedSimulations({ seasonId, scenario, onLoad, liveItems, balances }) {
  const { t } = useI18n()
  const { session, isMentor } = useAuth()
  const uid = session?.user?.id

  const [rows, setRows] = useState([])
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [copied, setCopied] = useState(null)
  // What a re-apply found, shown until dismissed. Held here rather than in an
  // alert() so the list of affected items is readable and stays put.
  const [report, setReport] = useState(null)

  const load = async () => {
    const { data, error } = await supabase
      .from('saved_simulations')
      .select('*')
      .eq('season_id', seasonId)
      .order('created_at', { ascending: false })
    if (!error) setRows(data || [])
  }
  useEffect(() => { if (seasonId) load() }, [seasonId])   // eslint-disable-line react-hooks/exhaustive-deps

  // Anything at all in the scenario is worth saving now — the picks are frozen
  // with their values, so a selection alone is a real thing to keep.
  const hasAnything = (scenario.extras?.length || 0)
    + (scenario.incomes?.length || 0)
    + (scenario.pickedIds?.length || 0) > 0

  const save = async () => {
    if (!name.trim()) { setErr(t('nameRequired')); return }
    setBusy(true); setErr('')
    // The picked rows are frozen with their VALUES, not just their ids. An id
    // alone reopens at whatever the item costs today, which is a different
    // number from the one that was on screen when this was saved.
    const byId = new Map((liveItems || []).map((i) => [i.id, i]))
    const picked = (scenario.pickedIds || []).map((id) => {
      const it = byId.get(id)
      if (!it) return null
      return {
        item_id: id,
        name: it.name,
        est_price: it.est_price,
        quantity: it.quantity,
        category_id: it.category_id,
        team_scope: it.team_scope,
        fund_account_id: scenario.fundBy?.[id] || null,
      }
    }).filter(Boolean)

    const { error } = await supabase.from('saved_simulations').insert({
      season_id: seasonId,
      name: name.trim(),
      extras: scenario.extras || [],
      incomes: scenario.incomes || [],
      fund_from: scenario.fundFrom || null,
      picked,
      balances: (balances || []).map((b) => ({ id: b.id, name: b.name, balance: b.balance })),
      snapshot_at: new Date().toISOString(),
    })
    setBusy(false)
    if (error) { setErr(error.message); return }
    setName('')
    load()
  }

  const remove = async (row) => {
    if (!window.confirm(t('confirmDelete'))) return
    const { error } = await supabase.from('saved_simulations').delete().eq('id', row.id)
    if (error) { setErr(error.message); return }
    load()
  }

  // Open the snapshot as it was, against today's list. Separate button from
  // "open", because they answer different questions: one is "what did we plan",
  // the other is "what would that plan cost now".
  const reapplyTo = (row) => {
    const r = reapply(row.picked || [], liveItems || [])
    onLoad({ ...row, _pickedIds: r.pickedIds })
    setReport({ name: row.name, ...r, savedTotal: snapshotTotal(row.picked || []) })
  }

  const share = async (row) => {
    const url = `${window.location.origin}${window.location.pathname}#/simulation?sim=${row.id}`
    try {
      // The share sheet on a phone, clipboard everywhere else. navigator.share
      // is the one people expect on mobile and it puts the link straight into
      // WhatsApp, which is where this will actually go.
      if (navigator.share) await navigator.share({ title: row.name, url })
      else {
        await navigator.clipboard.writeText(url)
        setCopied(row.id)
        setTimeout(() => setCopied(null), 2000)
      }
    } catch { /* the user dismissed the sheet */ }
  }

  return (
    <div className="panel panel-pad" style={{ marginBottom: 16 }}>
      <div className="section-title" style={{ marginTop: 0 }}>{t('savedSimulations')}</div>
      <p style={{ color: 'var(--text-faint)', fontSize: 12, margin: '0 0 10px' }}>
        {t('savedSimulationsHint')}
      </p>

      {err && <div className="empty" style={{ color: 'var(--danger)' }}>{err}</div>}

      {/* What survived the re-apply. A panel rather than an alert(): the whole
          value is in the LIST of affected items, and an alert shows one line
          and disappears. */}
      {report && (
        <div className="panel panel-pad" style={{
          marginBottom: 12,
          borderInlineStart: `3px solid var(--${report.clean ? 'ok' : 'orange'})`,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
            <b>{report.name}</b>
            <button className="btn btn-ghost btn-sm" onClick={() => setReport(null)}>✕</button>
          </div>

          {report.clean ? (
            <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--ok)' }}>
              {t('reapplyClean')}
            </p>
          ) : (
            <>
              {report.deltaTotal !== 0 && (
                <p style={{ margin: '6px 0 0', fontSize: 13 }}>
                  {t('reapplyDelta')
                    .replace('{was}', money(report.savedTotal))
                    .replace('{v}', money(Math.abs(report.deltaTotal)))
                    .replace('{dir}', report.deltaTotal > 0 ? t('moreExpensive') : t('cheaper'))}
                </p>
              )}

              {/* Each group named separately — "already bought" and "no longer
                  on the list" mean opposite things, and merging them into
                  "could not apply" would make a completed purchase look like a
                  loss. */}
              {[
                ['reapplyChanged', report.changed, 'var(--orange)'],
                ['reapplyBought', report.bought, 'var(--ok)'],
                ['reapplyMissing', report.missing, 'var(--danger)'],
              ].filter(([, list]) => list.length).map(([key, list, colour]) => (
                <div key={key} style={{ marginTop: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: colour }}>
                    {t(key).replace('{n}', list.length)}
                  </div>
                  <ul style={{ margin: '2px 0 0', paddingInlineStart: 18, fontSize: 13 }}>
                    {list.map((x, i) => (
                      <li key={x.item_id || i}>
                        {x.name}
                        {x.wasPrice != null && (
                          <span style={{ color: 'var(--text-faint)' }}>
                            {' '}{money(x.wasPrice)} ← {money(x.est_price)}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      <div className="toolbar">
        <input value={name} onChange={(e) => setName(e.target.value)}
          placeholder={t('simulationName')} />
        {/* Nothing typed means nothing to save — the picks are not persisted,
            so a save here would produce an empty scenario. */}
        <button className="btn btn-sm btn-primary" onClick={save}
          disabled={busy || !hasAnything}>
          {t('save')}
        </button>
      </div>
      {!hasAnything && (
        <p style={{ color: 'var(--text-faint)', fontSize: 12, margin: '6px 0 0' }}>
          {t('nothingTypedToSave')}
        </p>
      )}

      {rows.length > 0 && (
        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table className="data">
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.name}</td>
                  <td className="mono" style={{ color: 'var(--text-faint)', fontSize: 12 }}>
                    {fmtDate(r.created_at)}
                  </td>
                  <td>
                    <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
                      <button className="btn btn-ghost btn-sm" onClick={() => onLoad(r)}>
                        {t('openSim')}
                      </button>
                      {(r.picked?.length > 0) && (
                        <button className="btn btn-ghost btn-sm" onClick={() => reapplyTo(r)}>
                          {t('reapplySim')}
                        </button>
                      )}
                      <button className="btn btn-ghost btn-sm" onClick={() => share(r)}>
                        {copied === r.id ? t('copied') : t('share')}
                      </button>
                      {(r.created_by === uid || isMentor) && (
                        <button className="btn btn-ghost btn-sm btn-danger" onClick={() => remove(r)}>
                          {t('delete')}
                        </button>
                      )}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
