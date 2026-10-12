import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { App } from './App'
import { AuthProvider } from './lib/auth'
import { ToastProvider } from './lib/toast'
import { applyTheme, readTheme } from './lib/theme'

import './styles/tokens.css'
import './styles/base.css'
import './styles/ui.css'
import './styles/study.css'

applyTheme(readTheme())

const container = document.getElementById('root')
if (!container) {
  throw new Error('Missing #root')
}

createRoot(container).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)

// The service worker makes the installed app open instantly and keeps the
// library readable without a connection.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // An unavailable service worker only costs offline support.
    })
  })
}
