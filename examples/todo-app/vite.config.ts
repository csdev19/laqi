import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const LAQI = process.env.LAQI_URL ?? 'http://127.0.0.1:8000'

export default defineConfig({
  server: {
    port: 3000,
    // Proxy y no llamadas cross-origin a propósito: es como se ve un dev
    // setup real, y deja el navegador sin CORS de por medio. El front pide
    // /api/todos y laqi ve /todos.
    proxy: {
      '/api': { target: LAQI, changeOrigin: true, rewrite: (path) => path.replace(/^\/api/, '') },
    },
  },
  // El orden importa: tanstackStart genera el route tree y el entry, react()
  // compila el JSX que sale de ahí.
  plugins: [tanstackStart(), react()],
})
