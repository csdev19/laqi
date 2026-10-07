// apps/cli/src/serve.fixture.ts
//
// A per-test laboratory for the serve suites: a temporary project on disk,
// the servers started against it, and request helpers bound to THAT project.
//
// These used to be module-level `root` and `handle` variables that
// `beforeEach` replaced. That works until a test times out: vitest moves on
// to the next test, but the timed-out test's promise chain keeps running,
// and every `send` or `writeMocks` it still has queued now resolves against
// the NEXT test's server and directory. Under load, one slow test turned
// into two failures, the second with an assertion that made no sense on its
// own (a 400 from a route the test never exercised). A fixture binds the
// helpers to one test for its whole life, so a stale chain can only reach
// its own, already-closed server, where every call fails harmlessly.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ConfigSchema } from '@laqi/schema'
import { test as base } from 'vitest'
import { startServer, type ServeHandle } from './serve'

type StartOptions = Parameters<typeof startServer>[0]

/** Loopback on an OS-assigned port: what nearly every test wants. */
export const LOOPBACK = ConfigSchema.parse({ port: 0, host: '127.0.0.1' })

export type Lab = {
  /** The temporary project directory. `laqi/` already exists inside it. */
  root: string
  /** The server `start` brought up most recently. `get` and `send` target it. */
  handle: ServeHandle | undefined
  /**
   * `startServer` against this lab's root, on `LOOPBACK` unless told
   * otherwise. Whatever it starts is closed at teardown, even if the test
   * closed it first.
   */
  start: (options?: Partial<StartOptions>) => Promise<ServeHandle>
  /** Overwrites `laqi/api.json` (or another file under `laqi/`). */
  writeMocks: (contents: Record<string, unknown>, file?: string) => void
  readMocks: () => Record<string, { responses: Record<string, Record<string, unknown>> }>
  /** A request to the local port of `handle`. */
  get: (path: string, init?: RequestInit) => Promise<Response>
  /** A JSON request to the control plane of `handle`, mounted under `/__laqi`. */
  send: (path: string, method: string, body?: unknown) => Promise<Response>
}

export const it = base.extend<{ lab: Lab }>({
  // oxlint-disable-next-line no-empty-pattern -- vitest requires the destructuring form here
  lab: async ({}, use) => {
    const root = mkdtempSync(join(tmpdir(), 'laqi-serve-'))
    mkdirSync(join(root, 'laqi'), { recursive: true })
    const started: ServeHandle[] = []
    let tornDown = false

    const port = (): number => {
      if (!lab.handle) throw new Error('no server started through lab.start yet')
      return lab.handle.port
    }

    const lab: Lab = {
      root,
      handle: undefined,
      start: async (options = {}) => {
        const handle = await startServer({ root, config: LOOPBACK, ...options })
        if (tornDown) {
          // The test already timed out and was cleaned up while this
          // listener was still binding. Nobody will close it otherwise.
          await handle.close()
          throw new Error('lab.start resolved after its test was torn down')
        }
        started.push(handle)
        lab.handle = handle
        return handle
      },
      writeMocks: (contents, file = 'api.json') => {
        writeFileSync(join(root, 'laqi', file), JSON.stringify(contents, null, 2), 'utf8')
      },
      readMocks: () => JSON.parse(readFileSync(join(root, 'laqi', 'api.json'), 'utf8')) as never,
      get: (path, init) => fetch(`http://127.0.0.1:${port()}${path}`, init),
      send: (path, method, body) =>
        fetch(`http://127.0.0.1:${port()}/__laqi${path}`, {
          method,
          headers: { 'Content-Type': 'application/json' },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }),
    }

    await use(lab)

    tornDown = true
    // A test may have closed what it started already ("closes both
    // listeners" does, on purpose), and closing an http.Server twice rejects
    // with ERR_SERVER_NOT_RUNNING. That is not a failure of the test.
    await Promise.all(started.map((handle) => handle.close().catch(() => undefined)))
    rmSync(root, { recursive: true, force: true })
  },
})

/**
 * Loads the generation stack, TypeScript compiler included, into this
 * worker before the first test needs it.
 *
 * `POST /api/schema/import` with a pasted model is the request that imports
 * the 23 MB compiler. Idle, the first one takes about a second and a half;
 * on a loaded machine (several suites running at once, which is what
 * parallel worktrees do to it) it was measured at 13 to 16 seconds, most of
 * a 20 second test budget gone before the test's own steps began. Paid here,
 * it runs once per file under the hook budget, and every test in the file
 * then sees the warm cost only.
 */
export async function warmGenerationStack(): Promise<void> {
  const { importSchema } = await import('@laqi/generate')
  await importSchema({
    kind: 'typescript-paste',
    source: 'export interface Warm { id: number }',
  })
}
