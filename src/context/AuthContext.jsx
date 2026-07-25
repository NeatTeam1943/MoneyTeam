import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { supabase, withTimeout } from '../lib/supabase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [member, setMember] = useState(null)
  const [loading, setLoading] = useState(true)
  const loadedUid = useRef(null)   // which user's member row is currently loaded

  // Only re-queries when the signed-in user actually changes. A token refresh
  // (e.g. triggered by the focus/visibility listener below) re-fires
  // onAuthStateChange with the SAME user, and previously this re-ran the
  // members query every time; if that single request had any hiccup, the
  // empty result wiped `member` to null, which made the whole app render
  // "No permission" instead of the page the person was already on.
  async function loadMember(userId, { force = false } = {}) {
    if (!userId) { loadedUid.current = null; setMember(null); return }
    if (!force && loadedUid.current === userId) return   // nothing actually changed
    try {
      const { data, error } = await withTimeout(
        supabase.from('members').select('*').eq('id', userId).maybeSingle()
      )
      if (error) return              // transient failure — keep whatever member we already have
      loadedUid.current = userId
      setMember(data || null)
    } catch {
      // timed out or network hiccup — keep the existing member rather than blanking the app
    }
  }

  useEffect(() => {
    let done = false
    // Safety net: whatever happens, never leave the app stuck on "…" for more
    // than 8s. If the session check stalls, fall through to the login screen.
    const failsafe = setTimeout(() => { if (!done) setLoading(false) }, 8000)

    supabase.auth.getSession()
      .then(async ({ data }) => {
        setSession(data.session)
        await loadMember(data.session?.user?.id, { force: true })
      })
      .catch((e) => console.error('getSession failed', e))
      .finally(() => { done = true; clearTimeout(failsafe); setLoading(false) })

    const { data: sub } = supabase.auth.onAuthStateChange(async (_e, s) => {
      setSession(s)
      await loadMember(s?.user?.id)
    })
    // When returning to the tab (e.g. after the laptop slept), proactively refresh
    // the token so the next query doesn't fire with an expired one. This can
    // trigger onAuthStateChange above with the same user — loadMember's guard
    // means that no longer re-queries or risks wiping member state.
    const onFocus = () => { supabase.auth.getSession().catch(() => {}) }
    const onVis = () => { if (!document.hidden) onFocus() }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVis)
    return () => {
      clearTimeout(failsafe); sub.subscription.unsubscribe()
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [])

  const role = member?.role || null
  const isMentor = role === 'mentor'
  const isStudent = role === 'student'
  const value = {
    session,
    member,
    loading,
    role,
    isMentor,
    isStudent,
    // permission gates (mentor / student / viewer model)
    canTransact: isMentor,                       // income / expense / transfer / buy / delete tx
    canBudget: isMentor || isStudent,            // add & edit budgets
    canAddShopping: isMentor || isStudent,       // add & edit shopping items
    canChangeStatus: isMentor,                   // change a shopping item's status
    canSettings: isMentor,                       // manage config tables
    canEdit: isMentor,                           // legacy alias -> mentor only
    signOut: () => supabase.auth.signOut(),
  }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export const useAuth = () => useContext(AuthContext)
