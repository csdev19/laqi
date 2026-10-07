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
    // Under load (several suites running at once, as parallel worktrees
    // do), the compiler-bound requests scale with the load rather than with
    // the test, so the suites that chain several of them set their own
    // budget and warm the compiler in a hook: see `apps/cli/src/serve.fixture.ts`
    // for the measurements. The MCP stdio suite pins its own 30s hook
    // timeout inline, so the value below does not reach it.
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
})
