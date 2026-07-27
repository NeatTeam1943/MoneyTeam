import { createContext, useContext, useEffect, useMemo, useState } from 'react'

// The team runs FRC and FTC out of one budget. Most rows are shared ('both'),
// some belong to exactly one program. This is a global, top-bar-level filter —
// the same checklist governs every page, so "show me only FTC" is one click
// rather than a per-page control you have to set five times.
//
// Semantics, deliberately: a 'both' row ALWAYS matches. Ticking only FTC means
// "everything FTC touches" — its own items plus the shared ones — not "items
// literally tagged ftc". That's what makes the shared tag useful.

const TeamScopeContext = createContext(null)
const KEY = 'teamScope'
const VALID = ['frc', 'ftc']

export function TeamScopeProvider({ children }) {
  const [picked, setPicked] = useState(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY))
      const clean = Array.isArray(raw) ? raw.filter((v) => VALID.includes(v)) : []
      if (clean.length) return new Set(clean)
    } catch { /* corrupt/absent storage — fall through to the default */ }
    return new Set(VALID)
  })

  useEffect(() => { localStorage.setItem(KEY, JSON.stringify([...picked])) }, [picked])

  const value = useMemo(() => {
    const frc = picked.has('frc')
    const ftc = picked.has('ftc')
    const all = frc && ftc
    return {
      frc, ftc, all,
      // Unticking the last box would leave a filter that hides everything, so
      // it resets to "show all" instead of producing an empty screen.
      toggle: (k) => setPicked((s) => {
        const n = new Set(s)
        if (n.has(k)) n.delete(k); else n.add(k)
        return n.size ? n : new Set(VALID)
      }),
      matches: (scope) => all || !scope || scope === 'both' || picked.has(scope),
    }
  }, [picked])

  return <TeamScopeContext.Provider value={value}>{children}</TeamScopeContext.Provider>
}

// Safe default when a component renders outside the provider (tests, Storybook):
// everything matches, nothing is hidden.
const PASSTHROUGH = { frc: true, ftc: true, all: true, toggle: () => {}, matches: () => true }
export const useTeamScope = () => useContext(TeamScopeContext) || PASSTHROUGH
