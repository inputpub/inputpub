import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  // Served at the root of the inputpub.com custom domain.
  base: '/',
  plugins: [react()],
})
