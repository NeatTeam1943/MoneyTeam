import { Suspense, lazy } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import Layout from './components/Layout'
import Login from './pages/Login'

const Dashboard = lazy(() => import('./pages/Dashboard'))
const Transactions = lazy(() => import('./pages/Transactions'))
const Budgets = lazy(() => import('./pages/Budgets'))
const Shopping = lazy(() => import('./pages/Shopping'))
const Settings = lazy(() => import('./pages/Settings'))

export default function App() {
  const { session, member, loading } = useAuth()

  if (loading) {
    return <div className="center-screen"><div className="mono" style={{ color: 'var(--text-faint)' }}>…</div></div>
  }

  // Signed in but no members row = provisioned auth user with no access yet.
  if (session && !member) {
    return (
      <div className="center-screen">
        <div className="login-card panel panel-pad" style={{ textAlign: 'center' }}>
          <div className="tick-lg" style={{ margin: '0 auto 18px' }} />
          <p style={{ color: 'var(--text-dim)' }}>No permission. Contact a mentor.</p>
        </div>
      </div>
    )
  }

  if (!session) return <Login />

  return (
    <Layout>
      <Suspense fallback={<div className="mono" style={{ color: 'var(--text-faint)', padding: 8 }}>…</div>}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/transactions" element={<Transactions />} />
          <Route path="/budgets" element={<Budgets />} />
          <Route path="/shopping" element={<Shopping />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </Layout>
  )
}
