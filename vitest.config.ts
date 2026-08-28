import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['{packages,apps}/*/src/**/*.test.{ts,tsx}', 'scripts/**/*.test.ts'],
    // node por defecto; los tests de componentes piden jsdom por archivo con
    // `@vitest-environment jsdom`, para no cargar un DOM en los 200+ tests
    // que no lo necesitan.
    environment: 'node',
  },
})
