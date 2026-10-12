import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // The SPA and the API share an origin in production; the proxy keeps that
    // true in development so cookies behave identically.
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: false,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  build: {
    target: 'es2020',
    // The polyfill would inject an inline <script>, which the Content Security
    // Policy deliberately forbids. Browsers without modulepreload simply load
    // a little later.
    modulePreload: { polyfill: false },
    assetsInlineLimit: 2048,
    chunkSizeWarningLimit: 700,
  },
})
