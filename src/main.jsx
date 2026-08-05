import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import { I18nProvider } from './lib/i18n'
import { ThemeProvider } from './context/ThemeContext'
import { AuthProvider } from './context/AuthContext'
import { SeasonProvider } from './context/SeasonContext'
import { LookupsProvider } from './context/LookupsContext'
import { TeamScopeProvider } from './context/TeamScopeContext'
import { ToastProvider } from './lib/toast'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <I18nProvider>
      <ThemeProvider>
      <ToastProvider>
        <AuthProvider>
          <LookupsProvider>
            <SeasonProvider>
              <TeamScopeProvider>
                <HashRouter>
                  <App />
                </HashRouter>
              </TeamScopeProvider>
            </SeasonProvider>
          </LookupsProvider>
        </AuthProvider>
      </ToastProvider>
      </ThemeProvider>
    </I18nProvider>
  </React.StrictMode>
)
