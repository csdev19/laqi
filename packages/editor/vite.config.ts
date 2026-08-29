import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The panel is served mounted at /__laqi, never at the root: assets have to
// resolve relative to that base or index.html would request /assets/* and
// fall through to the user's mock server.
export default defineConfig({
  base: '/__laqi/',
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true },
})
