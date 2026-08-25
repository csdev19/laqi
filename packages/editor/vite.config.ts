import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// El panel se sirve montado en /__laqi, nunca en la raíz: los assets tienen
// que resolverse relativos a esa base o el index.html pediría /assets/* y
// caería en el mock server del usuario.
export default defineConfig({
  base: '/__laqi/',
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true },
})
