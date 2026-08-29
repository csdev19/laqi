import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const LAQI = process.env.LAQI_URL ?? 'http://127.0.0.1:8000'

export default defineConfig({
  server: {
    port: 3000,
    // Fail instead of walking to the next free port. Vite's default is to
    // move quietly, which leaves the app on a port nobody was told about:
    // the browser tab you had open keeps pointing at the old one, the
    // request dies with no response at all, and it reads like a CORS or
    // backend problem rather than "that port is taken". laqi itself refuses
    // to start on a busy port for the same reason.
    strictPort: true,
    // Proxy, not cross-origin calls, on purpose: it's what a real dev
    // setup looks like, and it leaves the browser with no CORS in the
    // way. The front asks for /api/todos and laqi sees /todos.
    proxy: {
      '/api': { target: LAQI, changeOrigin: true, rewrite: (path) => path.replace(/^\/api/, '') },
    },
  },
  // Order matters: tanstackStart generates the route tree and the entry,
  // react() compiles the JSX that comes out of it.
  plugins: [tanstackStart(), react()],
})
