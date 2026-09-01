import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The panel is served mounted at /__laqi, never at the root: assets have to
// resolve relative to that base or index.html would request /assets/* and
// fall through to the user's mock server.
//
// In dev, the panel's own HTML/JS comes from Vite (HMR), but the control
// plane lives in a running laqi server — start one on :8000 (e.g.
// `bun apps/cli/src/index.ts` from a project with mocks) and the proxy
// below forwards API calls and the SSE stream to it. Without a server
// running, the panel shows a control-plane connection error.
export default defineConfig({
  base: '/__laqi/',
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    proxy: {
      '/__laqi/api': 'http://127.0.0.1:8000',
      '/__laqi/events': 'http://127.0.0.1:8000',
    },
  },
})
