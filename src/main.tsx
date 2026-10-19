import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { App } from './App'
import { AuthProvider } from './lib/auth'
import { ToastProvider } from './lib/toast'
import { I18nProvider, applyLang, readLang } from './lib/i18n'
import { applyTheme, readTheme } from './lib/theme'
import { startUpdateWatch } from './lib/update'
import { UpdateBanner } from './components/UpdateBanner'

import './styles/tokens.css'
import './styles/base.css'
import './styles/ui.css'
import './styles/study.css'
import './styles/learn.css'

applyTheme(readTheme())
applyLang(readLang())

const container = document.getElementById('root')
if (!container) {
  throw new Error('Missing #root')
}

createRoot(container).render(
  <StrictMode>
    <BrowserRouter>
      <I18nProvider>
        <AuthProvider>
          <ToastProvider>
            <App />
            <UpdateBanner />
          </ToastProvider>
        </AuthProvider>
      </I18nProvider>
    </BrowserRouter>
  </StrictMode>,
)

// The service worker makes the installed app open instantly, keeps the library
// readable without a connection, and is how a new build reaches a phone that
// was installed months ago.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', startUpdateWatch)
}
