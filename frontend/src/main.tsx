import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import Pro from './Pro.tsx'

// Tiny pathname router — no library needed for two static pages. Direct loads
// of /pro work via the 404.html SPA fallback emitted at build time.
const isPro = window.location.pathname.replace(/\/$/, '') === '/pro'

createRoot(document.getElementById('root')!).render(
  <StrictMode>{isPro ? <Pro /> : <App />}</StrictMode>,
)
