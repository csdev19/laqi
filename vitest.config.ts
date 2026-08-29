import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['{packages,apps}/*/src/**/*.test.{ts,tsx}', 'scripts/**/*.test.ts'],
    // node by default; component tests opt into jsdom per file with
    // `@vitest-environment jsdom`, to avoid loading a DOM in the 200+ tests
    // that don't need one.
    environment: 'node',
  },
})
