const HISTORY_KEY = 'mt:calc:history'
const VARS_KEY = 'mt:calc:vars'
const FORMULA_KEY = 'mt:calc:formula'

// Kept short deliberately. History is for "what did I just work out", not a
// ledger — an unbounded list would grow until the read cost shows up on every
// open, and nobody scrolls back forty entries.
const MAX_HISTORY = 30

/**
 * localStorage, not cookies.
 *
 * Cookies were the ask, but they are capped near 4 kB for the whole domain and
 * are attached to EVERY request the page makes — including every Supabase
 * query. A growing calculation history would then be uploaded on each one,
 * which is a real cost for no benefit: nothing on the server reads this.
 *
 * localStorage gives ~5 MB, is never transmitted, and is already how the
 * simulation scenario persists.
 */
const read = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch { return fallback }        // private mode, or a corrupt entry
}

const write = (key, value) => {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* full */ }
}

export const loadHistory = () => read(HISTORY_KEY, [])

export function pushHistory(entry) {
  const next = [{ ...entry, at: Date.now() }, ...loadHistory()].slice(0, MAX_HISTORY)
  write(HISTORY_KEY, next)
  return next
}

export function clearHistory() {
  write(HISTORY_KEY, [])
  return []
}

export const loadVars = () => read(VARS_KEY, [])
export const saveVars = (vars) => write(VARS_KEY, vars)

export const loadFormula = () => read(FORMULA_KEY, '')
export const saveFormula = (f) => write(FORMULA_KEY, f)
