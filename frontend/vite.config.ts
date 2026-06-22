import { copyFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages has no SPA fallback: a direct hit on /pro 404s. Copying the
// built index.html to 404.html makes Pages serve the app for any unknown
// path, so client-side routing in main.tsx can take over.
function spaFallback() {
  return {
    name: 'spa-404-fallback',
    closeBundle() {
      const dist = resolve(__dirname, 'dist')
      copyFileSync(resolve(dist, 'index.html'), resolve(dist, '404.html'))
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  // Served at the root of the inputpub.com custom domain.
  base: '/',
  plugins: [react(), spaFallback()],
})
