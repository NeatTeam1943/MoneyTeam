import { createContext, useContext, useEffect, useState } from 'react'

const ThemeContext = createContext(null)
const KEY = 'theme'
export const THEMES = ['light', 'neat']

/**
 * Light or Neat mode (issue #5).
 *
 * The theme is a `data-theme` attribute on <html> and nothing more: index.css
 * redefines its variables under [data-theme="neat"], so every rule follows
 * automatically and no component has to know which theme is active.
 *
 * Applied to documentElement rather than a wrapper div so it also covers
 * things rendered outside the app root — modals, and the browser's own UI via
 * color-scheme.
 */
export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(() => {
    try {
      const saved = localStorage.getItem(KEY)
      if (THEMES.includes(saved)) return saved
    } catch { /* private mode: fall through to the default */ }
    return 'light'
  })

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    // The address bar / status bar colour, so the chrome matches the page
    // instead of leaving a light strip above a dark app.
    const meta = document.querySelector('meta[name="theme-color"]')
    if (meta) meta.setAttribute('content', theme === 'neat' ? '#00061f' : '#eef1f8')
    try { localStorage.setItem(KEY, theme) } catch { /* not fatal */ }
  }, [theme])

  return (
    <ThemeContext.Provider value={{
      theme,
      isNeat: theme === 'neat',
      toggle: () => setTheme((t) => (t === 'neat' ? 'light' : 'neat')),
      setTheme,
    }}>
      {children}
    </ThemeContext.Provider>
  )
}

export const useTheme = () => useContext(ThemeContext)
