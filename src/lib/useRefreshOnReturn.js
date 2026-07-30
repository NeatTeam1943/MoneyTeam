import { useEffect, useRef } from 'react'

/**
 * Re-fetch when the tab comes back into focus — but only if the data has had
 * time to go stale, and never at the cost of the reader's place on the page.
 *
 * The original version re-fetched on EVERY focus event. That is fine on a
 * dashboard you glance at, and wrong on a list you work down: step away for
 * two seconds to check a part number against the shelf, come back, and the
 * rows are replaced and the page is at the top again. Finding your place after
 * every comparison makes the list useless for the one job it exists for.
 *
 * Two changes:
 *
 *   staleAfterMs  a return within this window does nothing at all — no fetch,
 *                 no re-render, no jump. Long absences still refresh, which is
 *                 what the behaviour was for.
 *
 *   scroll        whatever refresh does happen restores the scroll position
 *                 afterwards, so even a genuine refresh leaves you where you
 *                 were rather than at the top.
 */
export function useRefreshOnReturn(load, { enabled = true, staleAfterMs = 60_000, deps = [] } = {}) {
  const lastRun = useRef(Date.now())
  const loadRef = useRef(load)
  loadRef.current = load

  useEffect(() => {
    if (!enabled) return undefined

    const run = async () => {
      if (document.hidden) return
      if (Date.now() - lastRun.current < staleAfterMs) return
      lastRun.current = Date.now()

      // Capture before the fetch; restore after React has painted the new
      // rows. Two frames because the first only guarantees the commit, not
      // the layout that follows it.
      const y = window.scrollY
      await loadRef.current()
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (Math.abs(window.scrollY - y) > 1) window.scrollTo({ top: y })
      }))
    }

    const onVis = () => { if (!document.hidden) run() }
    window.addEventListener('focus', run)
    document.addEventListener('visibilitychange', onVis)
    return () => {
      window.removeEventListener('focus', run)
      document.removeEventListener('visibilitychange', onVis)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, staleAfterMs, ...deps])

  /** Call after a deliberate save so the next return does not refetch needlessly. */
  return { markFresh: () => { lastRun.current = Date.now() } }
}
