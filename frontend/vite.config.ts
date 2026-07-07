import { copyFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Users' API tokens live in localStorage, so the main XSS payoff here would
// be reading them — a CSP that only runs same-origin scripts closes off the
// classic injected-markup routes. GitHub Pages can't set response headers, so
// it goes in as a meta tag. Notes on the loose directives:
// - connect-src stays open: the AI provider / S3 endpoints are user-configured
//   arbitrary hosts, so it can't be pinned to a list.
// - style-src allows inline: the editor (Crepe) writes style attributes.
// Injected only at build time — in dev, @vitejs/plugin-react needs an inline
// preamble script that `script-src 'self'` would block.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  'img-src * data: blob:',
  'media-src * data: blob:',
  'connect-src *',
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ')

function injectCsp() {
  return {
    name: 'inject-csp',
    apply: 'build' as const,
    transformIndexHtml() {
      return [
        {
          tag: 'meta',
          attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP },
          injectTo: 'head-prepend' as const,
        },
      ]
    },
  }
}

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
  plugins: [react(), tailwindcss(), injectCsp(), spaFallback()],
})
