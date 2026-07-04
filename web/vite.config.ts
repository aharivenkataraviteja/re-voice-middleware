import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Dev-only: the Express API runs separately on 8089 locally. In
      // production this app is built to static files and served by that
      // same Express service, so no proxy is needed there.
      '/api': 'http://localhost:8089',
    },
  },
  build: {
    outDir: 'dist',
  },
})
