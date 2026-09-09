import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['{packages,apps}/*/src/**/*.test.{ts,tsx}', 'scripts/**/*.test.ts'],
    // node by default; component tests opt into jsdom per file with
    // `@vitest-environment jsdom`, to avoid loading a DOM in the 200+ tests
    // that don't need one.
    environment: 'node',
    // Vitest's 5s default is the wrong budget for the tests that dynamically
    // import the 23 MB TypeScript compiler: `characterization.test.ts`
    // already hard-codes 30s inline for exactly that reason, and
    // `effect.test.ts` times out at 5s on a cold module cache.
    //
    // This reduces the suite's flakiness rather than removing it. Under load
    // the run still fails a varying handful of tests, always on time and
    // never on an assertion, including worker RPC timeouts that no test
    // budget covers. That was reproduced on main before any of this branch's
    // work, and the MCP stdio suite pins its own 30s hook timeout inline, so
    // the value below does not reach it. Diagnosing that is its own task.
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
})
