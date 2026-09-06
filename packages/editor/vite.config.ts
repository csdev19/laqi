import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The panel is served mounted at /__laqi, never at the root: assets have to
// resolve relative to that base or index.html would request /assets/* and
// fall through to the user's mock server.
//
// Two dev modes, because the panel is an app the CLI serves as static
// files, not a library a bundler could resolve to source:
//
// - `bun dev` (`vite build --watch`) keeps `dist/` current, so the panel
//   the CLI serves on :8000/__laqi is never stale. A reload picks up each
//   rebuild. In this mode `dist/` is NOT emptied per rebuild: Vite clears it
//   at every BUNDLE_START, which would leave a window with no index.html in
//   which the CLI serves its "not built yet" page. Hashed assets pile up
//   over a session; `index.html` always points at the current ones, and a
//   plain `vite build` still starts from an empty directory.
// - `bun run dev:hmr` (`vite`) serves the panel itself with HMR on :5173.
//   The control plane still lives in a running laqi server on :8000 — the
//   proxy below forwards API calls and the SSE stream to it. Without a
//   server running, the panel shows a control-plane connection error.
const watching = process.argv.includes('--watch')

export default defineConfig({
  base: '/__laqi/',
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: !watching },
  server: {
    proxy: {
      '/__laqi/api': 'http://127.0.0.1:8000',
      '/__laqi/events': 'http://127.0.0.1:8000',
    },
  },
})
