import { Suspense, lazy } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import Layout from './components/Layout'
import Login from './pages/Login'
import NameSetup from './pages/NameSetup'

const Dashboard = lazy(() => import('./pages/Dashboard'))
const Transactions = lazy(() => import('./pages/Transactions'))
const Budgets = lazy(() => import('./pages/Budgets'))
const Shopping = lazy(() => import('./pages/Shopping'))
const Reports = lazy(() => import('./pages/Reports'))
const Simulation = lazy(() => import('./pages/Simulation'))
const Settings = lazy(() => import('./pages/Settings'))

export default function App() {
  const { session, member, loading, isParent } = useAuth()

  if (loading) {
    return <div className="center-screen"><div className="mono" style={{ color: 'var(--text-faint)' }}>…</div></div>
  }

  // First-time sign-in with no members row yet: confirm a name once, before
  // showing "waiting for a mentor". supabase.auth.updateUser() inside
  // NameSetup fires a USER_UPDATED event that AuthContext already listens
  // for, so session.user.user_metadata refreshes on its own — no extra
  // plumbing needed here.
  if (session && !member && !isParent && !session.user?.user_metadata?.name_confirmed) {
    return <NameSetup user={session.user} onDone={() => {}} />
  }

  // Signed in but no members row = provisioned auth user with no access yet.
  // Guests deliberately have no members row, so they skip this.
  if (session && !member && !isParent) {
    return (
      <div className="center-screen">
        <div className="login-card panel panel-pad" style={{ textAlign: 'center' }}>
          <div className="tick-lg" style={{ margin: '0 auto 18px' }} />
          <p style={{ color: 'var(--text-dim)' }}>No permission. Contact a mentor.</p>
        </div>
      </div>
    )
  }

  // Guest mode has no session by design — that is the whole point — so it must
  // be checked before the login gate.
  if (!session && !isParent) return <Login />

  return (
    <Layout>
      <Suspense fallback={<div className="mono" style={{ color: 'var(--text-faint)', padding: 8 }}>…</div>}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/transactions" element={<Transactions />} />
          {/* Guests get these two and nothing else. The catch-all sends any
              hand-typed URL back to the dashboard, and the database refuses
              the queries regardless — this is convenience, not the control. */}
          {!isParent && <>
            <Route path="/budgets" element={<Budgets />} />
            <Route path="/shopping" element={<Shopping />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/simulation" element={<Simulation />} />
            <Route path="/settings" element={<Settings />} />
          </>}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </Layout>
  )
}
