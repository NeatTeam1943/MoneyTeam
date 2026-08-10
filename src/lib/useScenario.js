import { useCallback, useEffect, useRef, useState } from 'react'

const KEY = 'simulation-scenario'

/**
 * Keeps the simulation's what-if state across page changes.
 *
 * Stepping over to Transactions to check a figure used to throw away every
 * picked item, funding choice and ad-hoc row — so the page punished the one
 * thing you need to do while using it.
 *
 * localStorage, not the database, on purpose:
 *
 *   * A scenario is a draft. It has no owner, no approval and no audit trail,
 *     and putting drafts in the ledger's database invites someone to treat one
 *     as a decision.
 *   * It is per browser, which matches how it is used — one person working
 *     through an idea, not a team artefact.
 *   * It survives a reload and a navigation, which is the whole complaint, and
 *     costs no round trip on a page that already makes five.
 *
 * Keyed by season so a scenario for 2027 does not reappear inside 2026 with
 * item ids that no longer resolve.
 */
export function useScenario(seasonId, initial) {
  const [state, setState] = useState(initial)
  const loadedFor = useRef(null)

  // Restore once per season, before the first save can overwrite it.
  useEffect(() => {
    if (!seasonId || loadedFor.current === seasonId) return
    loadedFor.current = seasonId
    try {
      const raw = localStorage.getItem(`${KEY}:${seasonId}`)
      if (raw) setState({ ...initial, ...JSON.parse(raw) })
      else setState(initial)
    } catch { setState(initial) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seasonId])

  useEffect(() => {
    if (!seasonId || loadedFor.current !== seasonId) return
    try { localStorage.setItem(`${KEY}:${seasonId}`, JSON.stringify(state)) } catch { /* full or private */ }
  }, [seasonId, state])

  const clear = useCallback(() => {
    try { localStorage.removeItem(`${KEY}:${seasonId}`) } catch { /* ignore */ }
    setState(initial)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seasonId])

  /** Whether anything has actually been put in the scenario. */
  const isDirty = JSON.stringify(state) !== JSON.stringify(initial)

  return [state, setState, clear, isDirty]
}
