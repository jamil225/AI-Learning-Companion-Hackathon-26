import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/subjects': 'http://localhost:8081',
      '/progress': 'http://localhost:8081',
      '/lesson': 'http://localhost:8081',
      '/explain-simpler': 'http://localhost:8081',
      '/quiz': 'http://localhost:8081',
      '/chat': 'http://localhost:8081',
      '/upload': 'http://localhost:8081',
      '/revision-card': 'http://localhost:8081',
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.js',
  },
})
