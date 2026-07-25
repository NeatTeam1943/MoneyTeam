import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anon) {
  console.error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY.')
}

// Captured once, eagerly, at module load — BEFORE detectSessionInUrl below
// consumes and strips the URL's auth params. This is how the app knows "this
// visit is someone accepting an invite (or resetting a password) and needs
// to set a password before going any further", rather than a normal login.
export const authLandingType = (() => {
  try {
    const search = new URLSearchParams(window.location.search)
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
    return search.get('type') || hash.get('type') || null   // 'invite' | 'recovery' | 'signup' | null
  } catch { return null }
})()

// Pass-through lock disables navigator.locks, which could deadlock the first
// getSession() when a stale lock was left in storage (app stuck on "…").
const passthroughLock = async (_name, _acquireTimeout, fn) => fn()

// After the tab sits idle, the access token can expire before the background
// refresh timer fires. The next query then returns 401 and the list looks
// EMPTY until a manual page refresh. This fetch wrapper catches that 401,
// forces a session refresh, and retries the request once with the fresh token.
let _client
const authFetch = async (input, init = {}) => {
  let res = await fetch(input, init)
  if (res.status === 401 && _client) {
    try {
      const { data } = await _client.auth.getSession() // refreshes if expired
      const token = data?.session?.access_token
      if (token) {
        const headers = new Headers(init.headers || {})
        headers.set('Authorization', `Bearer ${token}`)
        res = await fetch(input, { ...init, headers })
      }
    } catch { /* fall through with the original 401 */ }
  }
  return res
}

export const supabase = createClient(url || 'http://localhost', anon || 'anon', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    // PKCE puts the login code in the URL's query string (?code=...) instead
    // of the hash (#access_token=...). That matters here specifically
    // because this app uses HashRouter for navigation (#/dashboard etc) —
    // with the old implicit flow, the router and Supabase's invite link were
    // both trying to use the same '#', and the router won, swallowing the
    // invite token before Supabase ever saw it.
    flowType: 'pkce',
    detectSessionInUrl: true,
    lock: passthroughLock,
  },
  global: { fetch: authFetch },
})
_client = supabase

// Races a query (or Promise.all of queries) against a timeout, so a request
// that Chrome silently drops (common after a backgrounded tab wakes up) can
// never leave a page stuck showing "loading" forever — it falls through and
// the caller can keep its last-known-good data instead of hanging.
export function withTimeout(promise, ms = 15000) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ])
}
