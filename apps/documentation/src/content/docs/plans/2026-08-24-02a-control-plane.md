---
title: "laqi v2 — Plan 2a: Control plane"
---

# laqi v2 — Plan 2a: Control plane

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A complete HTTP + SSE control plane under `/__laqi/api/*` and `/__laqi/events` — read and create/edit/delete endpoints (writing back to the mock files), read and mutate active state, read scenarios and server state, and a live stream of requests/reloads/errors. This is the API the web editor (Plan 2b) and the MCP server (Plan 3) will consume.

**Architecture:** Two separate Hono apps, composed into one: `createMockApp()` (Plan 1, untouched) serves the mocks; `createControlPlaneApp()` (new) serves `/__laqi/api/*` and the SSE, and is mounted separately so Plan 4 can exclude it from the tunnel without touching the mock-app. `packages/core` gains a file writer (`writer.ts`, read-modify-write JSON preserving the rest of the file) and a typed event bus (`events.ts`). `apps/cli/serve.ts` composes both apps, wires up the bus, and makes every write reload the runtime immediately — reusing Plan 1's hot-swap without touching it.

**Tech Stack:** Same as Plan 1 (Bun, TypeScript, Hono 4.12, Zod 4.3, Vitest). Adds `hono/streaming` (`streamSSE`) for SSE.

**Spec:** [`docs/design/design.md`](/design/design/) section 7 (API contracts, with the `DELETE` fix from finding H8), [`docs/design/state-model.md`](/design/state-model/), [`docs/design/review-vs-decisions.md`](/design/review-vs-decisions/) (H1, H4, H5, H7, H8, H9), [`docs/decisions/0006-mcp-server.md`](/decisions/0006-mcp-server/), [`docs/decisions/0007-public-url.md`](/decisions/0007-public-url/).

## Global Constraints

- **TDD is mandatory.** No production code without a failing test first.
- **Strict TypeScript**, ESM. No CommonJS.
- The control plane lives in a **separate Hono app** from the mock-app (`createControlPlaneApp()` ≠ `createMockApp()`), mounted together only in `apps/cli`. Never merge their routes into a single file — this is the separation Plan 4 needs so it can exclude `/__laqi` from the tunnel without touching the mocks code.
- **This plan does NOT implement the tunnel block.** That is Plan 4's responsibility (which decides how to keep `/__laqi/*` off the public URL). This plan only delivers the structural separation that makes it possible.
- `/__laqi` remains a reserved prefix (Plan 1, `RESERVED_PREFIX` in `@laqi/schema`) — no mock can occupy it. It's already enforced end-to-end; this plan doesn't touch it.
- **Every disk write validates against the corresponding Zod schema before writing.** An invalid endpoint definition is never persisted.
- **Every write reloads the runtime immediately**, in the same request that caused it — never rely solely on the file watcher (which also picks it up, redundantly and harmlessly, a few milliseconds later).
- The event bus is a closed type: `request | endpoints-changed | error`. Do not add `share-changed` — that belongs to Plan 4, which doesn't exist yet.
- Commits use Conventional Commits.

## Pre-verification note

Before writing this plan, the following was verified by running real code:

- `hono/streaming`'s `streamSSE` works correctly on `@hono/node-server`: correct content-type, events delivered in order, and **the listener cleanup on client disconnect (`onAbort`) does fire under real Node** — under plain Bun it does NOT fire (listener leak), but **this repo's tests (`bun run test` → vitest) run in a real Node process** (`process.versions.node` present, `typeof Bun === 'undefined'` inside the test), so the SSE cleanup test below is valid as written.
- Composing two Hono apps with `top.route('/__laqi', controlPlaneApp); top.route('/', mockApp)` works: each one's routes respond correctly, and a typo under `/__laqi/*` that neither route recognizes falls through to the mock-app's catch-all (this is not a security hole, because `/__laqi/*` is already forbidden to any mock — but the control-plane-app also gets its own catch-all regardless, for a clearer error message).
- A composite id like `"GET /users/:id/orders/:orderId"` travels correctly as a single `:id` path param if encoded with `encodeURIComponent` on the client and decoded with `decodeURIComponent` on the server — the exact round-trip was verified.

---

## File structure

```
packages/core/src/
├── events.ts                 NEW — LaqiEvent, EventBus
├── events.test.ts
├── writer.ts                 NEW — updateEndpointInFile, createEndpointInFile, deleteEndpointFromFile
├── writer.test.ts
└── index.ts                  MODIFY — export events and writer

packages/server/src/
├── control-plane-app.ts      NEW — createControlPlaneApp(runtime): Hono
├── control-plane-app.test.ts
├── mock-app.ts                MODIFY — MockRuntime gains an optional onRequest
├── mock-app.test.ts           MODIFY — test that onRequest fires
└── index.ts                   MODIFY — export control-plane-app

apps/cli/src/
├── serve.ts            MODIFY — composes control-plane + mock app, wires up the bus, writes trigger an immediate reload
└── serve.test.ts       MODIFY — integration tests: create/edit/delete over HTTP, end-to-end SSE
```

---

## Task 1: `packages/core` — event bus

**Files:**

- Create: `packages/core/src/events.ts`, `packages/core/src/events.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**

- Consumes: `LoadError` (Plan 1, already in `@laqi/core`)
- Produces: `type LaqiEvent = { type: 'request'; method: string; path: string; status: number; resolvedName: string; resolvedLayer: string; ms: number } | { type: 'endpoints-changed'; endpointCount: number } | { type: 'error'; file: string; line?: number; col?: number; message: string; excerpt?: string }`, `class EventBus { emit(event: LaqiEvent): void; subscribe(listener: (event: LaqiEvent) => void): () => void }`

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/src/events.test.ts
import { describe, expect, it, vi } from 'vitest'
import { EventBus, type LaqiEvent } from './events'

describe('EventBus', () => {
  it('delivers an emitted event to a subscribed listener', () => {
    const bus = new EventBus()
    const listener = vi.fn()
    bus.subscribe(listener)

    const event: LaqiEvent = { type: 'endpoints-changed', endpointCount: 3 }
    bus.emit(event)

    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith(event)
  })

  it('delivers to every subscriber', () => {
    const bus = new EventBus()
    const a = vi.fn()
    const b = vi.fn()
    bus.subscribe(a)
    bus.subscribe(b)

    bus.emit({ type: 'endpoints-changed', endpointCount: 1 })

    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)
  })

  it('stops delivering after unsubscribe', () => {
    const bus = new EventBus()
    const listener = vi.fn()
    const unsubscribe = bus.subscribe(listener)

    unsubscribe()
    bus.emit({ type: 'endpoints-changed', endpointCount: 1 })

    expect(listener).not.toHaveBeenCalled()
  })

  it('unsubscribing one listener does not affect another', () => {
    const bus = new EventBus()
    const a = vi.fn()
    const b = vi.fn()
    const unsubscribeA = bus.subscribe(a)
    bus.subscribe(b)

    unsubscribeA()
    bus.emit({ type: 'endpoints-changed', endpointCount: 1 })

    expect(a).not.toHaveBeenCalled()
    expect(b).toHaveBeenCalledTimes(1)
  })

  it('carries a request event with the exact fields the log needs', () => {
    const bus = new EventBus()
    const listener = vi.fn()
    bus.subscribe(listener)

    const event: LaqiEvent = {
      type: 'request',
      method: 'GET',
      path: '/users',
      status: 200,
      resolvedName: 'ok',
      resolvedLayer: 'default',
      ms: 4,
    }
    bus.emit(event)

    expect(listener).toHaveBeenCalledWith(event)
  })

  it('carries an error event with file position', () => {
    const bus = new EventBus()
    const listener = vi.fn()
    bus.subscribe(listener)

    const event: LaqiEvent = {
      type: 'error',
      file: 'laqi/api.json',
      line: 4,
      col: 7,
      message: 'trailing comma',
      excerpt: '4 | }\n  | ^',
    }
    bus.emit(event)

    expect(listener).toHaveBeenCalledWith(event)
  })

  it('a listener throwing does not stop delivery to the next listener', () => {
    const bus = new EventBus()
    const broken = vi.fn(() => {
      throw new Error('boom')
    })
    const healthy = vi.fn()
    bus.subscribe(broken)
    bus.subscribe(healthy)

    expect(() => bus.emit({ type: 'endpoints-changed', endpointCount: 1 })).not.toThrow()
    expect(healthy).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `bun run test -- events`
Expected: FAIL — `Failed to resolve import "./events"`

- [ ] **Step 3: Implement**

```ts
// packages/core/src/events.ts

export type LaqiEvent =
  | {
      type: 'request'
      method: string
      path: string
      status: number
      resolvedName: string
      resolvedLayer: string
      ms: number
    }
  | { type: 'endpoints-changed'; endpointCount: number }
  | { type: 'error'; file: string; line?: number; col?: number; message: string; excerpt?: string }

/**
 * An in-memory, single-process bus. There is no queue or persistence: a
 * subscriber that isn't connected when something happens misses it — that's
 * fine, it's exactly what flow F3 (watching requests live) expects.
 */
export class EventBus {
  private listeners = new Set<(event: LaqiEvent) => void>()

  emit(event: LaqiEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch {
        // A broken subscriber must not take down the others or the emitter.
      }
    }
  }

  subscribe(listener: (event: LaqiEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `bun run test -- events`
Expected: PASS, 7 tests.

- [ ] **Step 5: Export from the index**

```ts
// packages/core/src/index.ts
export * from './json-position'
export * from './loader'
export * from './route-table'
export * from './state-store'
export * from './resolve'
export * from './events'
```

- [ ] **Step 6: Commit**

```bash
git add packages/core
git commit -m "feat(core): add typed in-memory event bus for the control plane"
```

---

## Task 2: `packages/core` — file writer: update and delete

**Files:**

- Create: `packages/core/src/writer.ts`, `packages/core/src/writer.test.ts`

**Interfaces:**

- Consumes: `EndpointSchema`, `type EndpointDefinition` (Plan 1, `@laqi/schema`)
- Produces: `type WriteResult = { ok: true } | { ok: false; error: string }`, `updateEndpointInFile(params: { root: string; file: string; id: string; definition: EndpointDefinition }): WriteResult`, `deleteEndpointFromFile(params: { root: string; file: string; id: string }): WriteResult`

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/src/writer.test.ts
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { deleteEndpointFromFile, updateEndpointInFile } from './writer'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'laqi-writer-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function writeMock(relative: string, contents: unknown) {
  const full = join(root, relative)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, JSON.stringify(contents, null, 2), 'utf8')
}

function readMock(relative: string): unknown {
  return JSON.parse(readFileSync(join(root, relative), 'utf8'))
}

const okDefinition = { default: 'ok', responses: { ok: { status: 200, body: [] } } }

describe('updateEndpointInFile', () => {
  it('replaces the value at the existing key, in place', () => {
    writeMock('laqi/api.json', {
      'GET /users': { default: 'ok', responses: { ok: { status: 200, body: [] } } },
      'GET /orders': { default: 'ok', responses: { ok: { status: 200, body: [] } } },
    })

    const updated = {
      default: 'empty',
      responses: { ok: { status: 200, body: [] }, empty: { status: 200, body: [] } },
    }
    const result = updateEndpointInFile({ root, file: 'laqi/api.json', id: 'GET /users', definition: updated })

    expect(result.ok).toBe(true)
    const contents = readMock('laqi/api.json') as Record<string, unknown>
    expect(contents['GET /users']).toEqual(updated)
    expect(contents['GET /orders']).toEqual({ default: 'ok', responses: { ok: { status: 200, body: [] } } })
  })

  it('preserves sibling key order', () => {
    writeMock('laqi/api.json', { a: okDefinition, b: okDefinition, c: okDefinition })
    updateEndpointInFile({ root, file: 'laqi/api.json', id: 'b', definition: { default: 'ok', responses: { ok: { status: 201, body: {} } } } })
    expect(Object.keys(readMock('laqi/api.json') as object)).toEqual(['a', 'b', 'c'])
  })

  it('rejects an invalid definition without writing anything', () => {
    writeMock('laqi/api.json', { 'GET /users': okDefinition })
    const before = readFileSync(join(root, 'laqi/api.json'), 'utf8')

    const result = updateEndpointInFile({
      root,
      file: 'laqi/api.json',
      id: 'GET /users',
      definition: { default: 'nope', responses: { ok: { status: 200 } } } as never,
    })

    expect(result.ok).toBe(false)
    expect(readFileSync(join(root, 'laqi/api.json'), 'utf8')).toBe(before)
  })

  it('fails cleanly when the id does not exist in the file', () => {
    writeMock('laqi/api.json', { 'GET /users': okDefinition })
    const result = updateEndpointInFile({ root, file: 'laqi/api.json', id: 'GET /ghost', definition: okDefinition })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('GET /ghost')
  })

  it('fails cleanly when the file does not exist', () => {
    const result = updateEndpointInFile({ root, file: 'laqi/nope.json', id: 'GET /users', definition: okDefinition })
    expect(result.ok).toBe(false)
  })
})

describe('deleteEndpointFromFile', () => {
  it('removes the key and leaves siblings untouched', () => {
    writeMock('laqi/api.json', { 'GET /users': okDefinition, 'GET /orders': okDefinition })
    const result = deleteEndpointFromFile({ root, file: 'laqi/api.json', id: 'GET /users' })

    expect(result.ok).toBe(true)
    const contents = readMock('laqi/api.json') as Record<string, unknown>
    expect('GET /users' in contents).toBe(false)
    expect(contents['GET /orders']).toEqual(okDefinition)
  })

  it('fails cleanly when the id does not exist', () => {
    writeMock('laqi/api.json', { 'GET /users': okDefinition })
    const result = deleteEndpointFromFile({ root, file: 'laqi/api.json', id: 'GET /ghost' })
    expect(result.ok).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `bun run test -- writer`
Expected: FAIL — `Failed to resolve import "./writer"`

- [ ] **Step 3: Implement**

```ts
// packages/core/src/writer.ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { EndpointSchema, type EndpointDefinition } from '@laqi/schema'

export type WriteResult = { ok: true } | { ok: false; error: string }

function readFileObject(fullPath: string): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  if (!existsSync(fullPath)) return { ok: false, error: `file not found: ${fullPath}` }

  try {
    const parsed: unknown = JSON.parse(readFileSync(fullPath, 'utf8'))
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { ok: false, error: `not a JSON object: ${fullPath}` }
    }
    return { ok: true, value: parsed as Record<string, unknown> }
  } catch (error) {
    return { ok: false, error: `invalid JSON: ${error instanceof Error ? error.message : String(error)}` }
  }
}

function writeFileObject(fullPath: string, contents: Record<string, unknown>): void {
  writeFileSync(fullPath, `${JSON.stringify(contents, null, 2)}\n`, 'utf8')
}

export function updateEndpointInFile(params: {
  root: string
  file: string
  id: string
  definition: EndpointDefinition
}): WriteResult {
  const { root, file, id, definition } = params
  const fullPath = join(root, file)

  const validated = EndpointSchema.safeParse(definition)
  if (!validated.success) {
    return { ok: false, error: validated.error.issues.map((i) => i.message).join('; ') }
  }

  const read = readFileObject(fullPath)
  if (!read.ok) return read

  if (!Object.hasOwn(read.value, id)) {
    return { ok: false, error: `no endpoint ${JSON.stringify(id)} in ${file}` }
  }

  read.value[id] = validated.data
  writeFileObject(fullPath, read.value)
  return { ok: true }
}

export function createEndpointInFile(params: {
  root: string
  file: string
  id: string
  definition: EndpointDefinition
}): WriteResult {
  const { root, file, id, definition } = params
  const fullPath = join(root, file)

  const validated = EndpointSchema.safeParse(definition)
  if (!validated.success) {
    return { ok: false, error: validated.error.issues.map((i) => i.message).join('; ') }
  }

  // The file may not exist yet (the first endpoint created from the panel).
  const read = existsSync(fullPath) ? readFileObject(fullPath) : { ok: true as const, value: {} }
  if (!read.ok) return read

  if (Object.hasOwn(read.value, id)) {
    return { ok: false, error: `${JSON.stringify(id)} already exists in ${file}` }
  }

  read.value[id] = validated.data
  writeFileObject(fullPath, read.value)
  return { ok: true }
}

export function deleteEndpointFromFile(params: { root: string; file: string; id: string }): WriteResult {
  const { root, file, id } = params
  const fullPath = join(root, file)

  const read = readFileObject(fullPath)
  if (!read.ok) return read

  if (!Object.hasOwn(read.value, id)) {
    return { ok: false, error: `no endpoint ${JSON.stringify(id)} in ${file}` }
  }

  delete read.value[id]
  writeFileObject(fullPath, read.value)
  return { ok: true }
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `bun run test -- writer`
Expected: PASS, 7 tests (`updateEndpointInFile` and `deleteEndpointFromFile`; `createEndpointInFile` is tested in Task 3, though its implementation is already written here since it shares the same file and the same internal functions).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/writer.ts packages/core/src/writer.test.ts
git commit -m "feat(core): write endpoint updates and deletions back to mock files"
```

---

## Task 3: `packages/core` — file writer: create

**Files:**

- Modify: `packages/core/src/writer.test.ts`, `packages/core/src/index.ts`

**Interfaces:**

- Consumes: `createEndpointInFile` (already implemented in Task 2, not yet tested)
- Produces: no new symbols — this task only adds coverage and the export

- [ ] **Step 1: Write the failing test**

Add to the end of `packages/core/src/writer.test.ts` (after the `describe('deleteEndpointFromFile', ...)` block):

```ts
describe('createEndpointInFile', () => {
  it('creates the file if it does not exist yet, with the one endpoint', () => {
    const result = createEndpointInFile({ root, file: 'laqi/api.json', id: 'GET /users', definition: okDefinition })

    expect(result.ok).toBe(true)
    expect(readMock('laqi/api.json')).toEqual({ 'GET /users': okDefinition })
  })

  it('appends to an existing file without touching its other keys', () => {
    writeMock('laqi/api.json', { 'GET /users': okDefinition })
    const result = createEndpointInFile({
      root,
      file: 'laqi/api.json',
      id: 'GET /orders',
      definition: { default: 'ok', responses: { ok: { status: 200, body: [] } } },
    })

    expect(result.ok).toBe(true)
    const contents = readMock('laqi/api.json') as Record<string, unknown>
    expect(contents['GET /users']).toEqual(okDefinition)
    expect(contents['GET /orders']).toBeDefined()
  })

  it('refuses to overwrite an id that already exists', () => {
    writeMock('laqi/api.json', { 'GET /users': okDefinition })
    const result = createEndpointInFile({ root, file: 'laqi/api.json', id: 'GET /users', definition: okDefinition })
    expect(result.ok).toBe(false)
  })

  it('rejects an invalid definition without creating the file', () => {
    const result = createEndpointInFile({
      root,
      file: 'laqi/api.json',
      id: 'GET /users',
      definition: { default: 'ghost', responses: { ok: { status: 200 } } } as never,
    })
    expect(result.ok).toBe(false)
    expect(existsSync(join(root, 'laqi/api.json'))).toBe(false)
  })
})
```

And add `existsSync` to the `node:fs` import at the top of the test file:

```ts
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `bun run test -- writer`
Expected: FAIL — `existsSync` not yet imported in the test causes a reference error before it even runs, or (if the import was already added) the 4 new `createEndpointInFile` tests pass right away because Task 2's implementation already includes it. **If the 4 new tests pass immediately, that is correct** — the implementation was written in full in Task 2 because the three functions share the same file; this task is what puts it under explicit test. Confirm anyway with the command below.

- [ ] **Step 3: Confirm and export from the index**

`packages/core/src/writer.ts` does not change. It just needs exporting:

```ts
// packages/core/src/index.ts
export * from './json-position'
export * from './loader'
export * from './route-table'
export * from './state-store'
export * from './resolve'
export * from './events'
export * from './writer'
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `bun run test -- writer`
Expected: PASS, 11 tests total (7 from Task 2 + 4 new).

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "test(core): cover createEndpointInFile, export writer from @laqi/core"
```

## Task 4: `packages/server` — control plane: reading endpoints, reading/mutating state

Starts the `control-plane-app.ts` file. Establishes the app's full shape (with its own catch-all at the end) so Tasks 5–8 only insert new routes before that catch-all, at an exact insertion point — the same pattern that already worked in Plan 1 for `mock-app.ts`.

**Files:**

- Create: `packages/server/src/control-plane-app.ts`, `packages/server/src/control-plane-app.test.ts`

**Interfaces:**

- Consumes: `type LoadedEndpoint` (`@laqi/core`); `StateSchema`, `type LaqiState` (`@laqi/schema`)
- Produces: `type ControlPlaneRuntime = { getEndpoints: () => LoadedEndpoint[]; getState: () => LaqiState; setState: (state: LaqiState) => void; ... }` (the type is completed in later tasks, but the name and these first two fields are fixed from here on), `createControlPlaneApp(runtime: ControlPlaneRuntime): Hono`

- [ ] **Step 1: Write the failing test**

```ts
// packages/server/src/control-plane-app.test.ts
import type { LoadedEndpoint } from '@laqi/core'
import type { LaqiState } from '@laqi/schema'
import { describe, expect, it, vi } from 'vitest'
import { createControlPlaneApp, type ControlPlaneRuntime } from './control-plane-app'

const usersEndpoint: LoadedEndpoint = {
  id: 'GET /users',
  method: 'GET',
  path: '/users',
  default: 'ok',
  responses: { ok: { status: 200, body: [] }, boom: { status: 500, body: {} } },
  file: 'laqi/api.json',
  line: 2,
}

function makeRuntime(overrides: Partial<ControlPlaneRuntime> = {}): ControlPlaneRuntime {
  let state: LaqiState = { scenario: null, overrides: {} }
  return {
    getEndpoints: () => [usersEndpoint],
    getState: () => state,
    setState: (next) => {
      state = next
    },
    ...overrides,
  }
}

describe('GET /api/endpoints', () => {
  it('lists the loaded endpoints', async () => {
    const app = createControlPlaneApp(makeRuntime())
    const res = await app.request('/api/endpoints')
    expect(res.status).toBe(200)
    const body = (await res.json()) as LoadedEndpoint[]
    expect(body).toEqual([usersEndpoint])
  })
})

describe('GET /api/state', () => {
  it('returns the current state', async () => {
    const app = createControlPlaneApp(makeRuntime({ getState: () => ({ scenario: 'checkout-broken', overrides: { 'GET /users': 'boom' } }) }))
    const res = await app.request('/api/state')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ scenario: 'checkout-broken', overrides: { 'GET /users': 'boom' } })
  })
})

describe('PUT /api/state', () => {
  it('persists a valid state and echoes it back', async () => {
    const setState = vi.fn()
    const app = createControlPlaneApp(makeRuntime({ setState }))

    const res = await app.request('/api/state', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scenario: null, overrides: { 'GET /users': 'boom' } }),
    })

    expect(res.status).toBe(200)
    expect(setState).toHaveBeenCalledWith({ scenario: null, overrides: { 'GET /users': 'boom' } })
    expect(await res.json()).toEqual({ scenario: null, overrides: { 'GET /users': 'boom' } })
  })

  it('fills in defaults for a partial body', async () => {
    const setState = vi.fn()
    const app = createControlPlaneApp(makeRuntime({ setState }))

    const res = await app.request('/api/state', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })

    expect(res.status).toBe(200)
    expect(setState).toHaveBeenCalledWith({ scenario: null, overrides: {} })
  })

  it('rejects a malformed body with 400 and does not call setState', async () => {
    const setState = vi.fn()
    const app = createControlPlaneApp(makeRuntime({ setState }))

    const res = await app.request('/api/state', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ overrides: 42 }),
    })

    expect(res.status).toBe(400)
    expect(setState).not.toHaveBeenCalled()
  })

  it('rejects a body that is not valid JSON at all', async () => {
    const app = createControlPlaneApp(makeRuntime())
    const res = await app.request('/api/state', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    })
    expect(res.status).toBe(400)
  })
})

describe('unmatched /__laqi paths', () => {
  it('returns a control-plane-flavoured 404, not a bare Hono 404', async () => {
    const app = createControlPlaneApp(makeRuntime())
    const res = await app.request('/api/nope')
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('laqi-control-plane')
  })
})
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `bun run test -- control-plane-app`
Expected: FAIL — `Failed to resolve import "./control-plane-app"`

- [ ] **Step 3: Implement**

```ts
// packages/server/src/control-plane-app.ts
import type { LoadedEndpoint } from '@laqi/core'
import { StateSchema, type LaqiState } from '@laqi/schema'
import { Hono } from 'hono'

/**
 * Everything the control plane needs from the process hosting it. Each
 * task in this plan adds the fields its routes need — this type becomes
 * the complete contract only at the end of Task 8.
 */
export type ControlPlaneRuntime = {
  getEndpoints: () => LoadedEndpoint[]
  getState: () => LaqiState
  setState: (state: LaqiState) => void
}

export function createControlPlaneApp(runtime: ControlPlaneRuntime): Hono {
  const app = new Hono()

  app.get('/api/endpoints', (c) => c.json(runtime.getEndpoints()))

  app.get('/api/state', (c) => c.json(runtime.getState()))

  app.put('/api/state', async (c) => {
    let raw: unknown
    try {
      raw = await c.req.json()
    } catch {
      return c.json({ error: 'laqi-control-plane', message: 'body is not valid JSON' }, 400)
    }

    const parsed = StateSchema.safeParse(raw)
    if (!parsed.success) {
      return c.json(
        { error: 'laqi-control-plane', message: parsed.error.issues.map((i) => i.message).join('; ') },
        400,
      )
    }

    runtime.setState(parsed.data)
    return c.json(parsed.data)
  })

  // Insertion point for Tasks 5–8: new routes go HERE,
  // before this catch-all — never after.
  app.all('*', (c) =>
    c.json({ error: 'laqi-control-plane', message: 'no matching route', path: c.req.path }, 404),
  )

  return app
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `bun run test -- control-plane-app`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/control-plane-app.ts packages/server/src/control-plane-app.test.ts
git commit -m "feat(server): control plane — read endpoints, read/write state"
```

---

## Task 5: `packages/server` — control plane: scenarios and server status

**Files:**

- Modify: `packages/server/src/control-plane-app.ts`, `packages/server/src/control-plane-app.test.ts`

**Interfaces:**

- Consumes: `type Scenarios` (`@laqi/schema`); `type LoadError` (`@laqi/core`)
- Produces: `ControlPlaneRuntime` gains `getScenarios: () => Scenarios` and `getStatus: () => { watching: string; endpointCount: number; address: string; errors: LoadError[] }`

- [ ] **Step 1: Write the failing test**

Add to `packages/server/src/control-plane-app.test.ts`, after `describe('unmatched /__laqi paths', ...)`:

```ts
describe('GET /api/scenarios', () => {
  it('returns the loaded scenarios', async () => {
    const app = createControlPlaneApp(
      makeRuntime({ getScenarios: () => ({ 'checkout-broken': { 'GET /users': 'boom' } }) }),
    )
    const res = await app.request('/api/scenarios')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ 'checkout-broken': { 'GET /users': 'boom' } })
  })
})

describe('GET /api/status', () => {
  it('returns what the CLI is watching, and load errors', async () => {
    const app = createControlPlaneApp(
      makeRuntime({
        getStatus: () => ({
          watching: 'laqi/',
          endpointCount: 27,
          address: '127.0.0.1:8000',
          errors: [{ file: 'laqi/orders.json', line: 14, col: 7, message: 'trailing comma', excerpt: '...' }],
        }),
      }),
    )
    const res = await app.request('/api/status')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      watching: 'laqi/',
      endpointCount: 27,
      address: '127.0.0.1:8000',
      errors: [{ file: 'laqi/orders.json', line: 14, col: 7, message: 'trailing comma', excerpt: '...' }],
    })
  })
})
```

And add `getScenarios`/`getStatus` to the `makeRuntime` helper's default so every other test in the file keeps working:

```ts
function makeRuntime(overrides: Partial<ControlPlaneRuntime> = {}): ControlPlaneRuntime {
  let state: LaqiState = { scenario: null, overrides: {} }
  return {
    getEndpoints: () => [usersEndpoint],
    getState: () => state,
    setState: (next) => {
      state = next
    },
    getScenarios: () => ({}),
    getStatus: () => ({ watching: 'laqi/', endpointCount: 1, address: '127.0.0.1:8000', errors: [] }),
    ...overrides,
  }
}
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `bun run test -- control-plane-app`
Expected: FAIL — `TypeError: runtime.getScenarios is not a function` (or similar), because `createControlPlaneApp` does not expose those routes yet.

- [ ] **Step 3: Implement**

In `packages/server/src/control-plane-app.ts`, add the two fields to the type:

```ts
export type ControlPlaneRuntime = {
  getEndpoints: () => LoadedEndpoint[]
  getState: () => LaqiState
  setState: (state: LaqiState) => void
  getScenarios: () => Scenarios
  getStatus: () => { watching: string; endpointCount: number; address: string; errors: LoadError[] }
}
```

Replace the two import lines at the top of the file (the ones Task 4 wrote):

```ts
import type { LoadedEndpoint } from '@laqi/core'
import { StateSchema, type LaqiState } from '@laqi/schema'
```

with:

```ts
import type { LoadedEndpoint, LoadError } from '@laqi/core'
import { StateSchema, type LaqiState, type Scenarios } from '@laqi/schema'
```

(The third line, `import { Hono } from 'hono'`, doesn't change — leave it as is.)

Replace:

```ts
  // Insertion point for Tasks 5–8: new routes go HERE,
  // before this catch-all — never after.
  app.all('*', (c) =>
```

with:

```ts
  app.get('/api/scenarios', (c) => c.json(runtime.getScenarios()))

  app.get('/api/status', (c) => c.json(runtime.getStatus()))

  // Insertion point for Tasks 6–8: new routes go HERE,
  // before this catch-all — never after.
  app.all('*', (c) =>
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `bun run test -- control-plane-app`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/control-plane-app.ts packages/server/src/control-plane-app.test.ts
git commit -m "feat(server): control plane — read scenarios and server status"
```

## Task 6: `packages/server` — control plane: creating an endpoint

**Files:**

- Modify: `packages/server/src/control-plane-app.ts`, `packages/server/src/control-plane-app.test.ts`

**Interfaces:**

- Consumes: `isHttpMethod`, `formatEndpointId`, `type HttpMethod`, `EndpointSchema` (`@laqi/schema`, Plan 1)
- Produces: `ControlPlaneRuntime` gains `createEndpoint: (input: { method: HttpMethod; path: string; description?: string; default: string; responses: Record<string, unknown> }) => { ok: true; id: string } | { ok: false; error: string }`

- [ ] **Step 1: Write the failing test**

Add to `packages/server/src/control-plane-app.test.ts`:

```ts
describe('POST /api/endpoints', () => {
  it('creates the endpoint and returns 201 with its id', async () => {
    const createEndpoint = vi.fn(() => ({ ok: true as const, id: 'POST /orders' }))
    const app = createControlPlaneApp(makeRuntime({ createEndpoint }))

    const res = await app.request('/api/endpoints', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        method: 'POST',
        path: '/orders',
        default: 'created',
        responses: { created: { status: 201, body: {} } },
      }),
    })

    expect(res.status).toBe(201)
    expect(createEndpoint).toHaveBeenCalledWith({
      method: 'POST',
      path: '/orders',
      description: undefined,
      default: 'created',
      responses: { created: { status: 201, body: {} } },
    })
    expect(await res.json()).toEqual({ id: 'POST /orders' })
  })

  it('rejects an unknown HTTP method', async () => {
    const createEndpoint = vi.fn()
    const app = createControlPlaneApp(makeRuntime({ createEndpoint }))

    const res = await app.request('/api/endpoints', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: 'FETCH', path: '/orders', default: 'ok', responses: { ok: { status: 200 } } }),
    })

    expect(res.status).toBe(400)
    expect(createEndpoint).not.toHaveBeenCalled()
  })

  it('rejects a path that does not start with "/"', async () => {
    const createEndpoint = vi.fn()
    const app = createControlPlaneApp(makeRuntime({ createEndpoint }))

    const res = await app.request('/api/endpoints', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: 'GET', path: 'orders', default: 'ok', responses: { ok: { status: 200 } } }),
    })

    expect(res.status).toBe(400)
    expect(createEndpoint).not.toHaveBeenCalled()
  })

  it('rejects an invalid endpoint definition (no responses)', async () => {
    const createEndpoint = vi.fn()
    const app = createControlPlaneApp(makeRuntime({ createEndpoint }))

    const res = await app.request('/api/endpoints', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: 'GET', path: '/orders', default: 'ok', responses: {} }),
    })

    expect(res.status).toBe(400)
    expect(createEndpoint).not.toHaveBeenCalled()
  })

  it('propagates a failure from the runtime (e.g. duplicate id) as a client error', async () => {
    const createEndpoint = vi.fn(() => ({ ok: false as const, error: '"GET /orders" already exists' }))
    const app = createControlPlaneApp(makeRuntime({ createEndpoint }))

    const res = await app.request('/api/endpoints', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: 'GET', path: '/orders', default: 'ok', responses: { ok: { status: 200 } } }),
    })

    expect(res.status).toBe(409)
    const body = (await res.json()) as { message: string }
    expect(body.message).toContain('already exists')
  })
})
```

And add `createEndpoint` to the `makeRuntime` default:

```ts
    getScenarios: () => ({}),
    getStatus: () => ({ watching: 'laqi/', endpointCount: 1, address: '127.0.0.1:8000', errors: [] }),
    createEndpoint: () => ({ ok: true, id: 'GET /new' }),
    ...overrides,
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `bun run test -- control-plane-app`
Expected: FAIL — `POST /api/endpoints` doesn't exist yet, falls through to the catch-all (404, not 201/400/409).

- [ ] **Step 3: Implement**

In `packages/server/src/control-plane-app.ts`, add to the type:

```ts
export type ControlPlaneRuntime = {
  getEndpoints: () => LoadedEndpoint[]
  getState: () => LaqiState
  setState: (state: LaqiState) => void
  getScenarios: () => Scenarios
  getStatus: () => { watching: string; endpointCount: number; address: string; errors: LoadError[] }
  createEndpoint: (input: {
    method: HttpMethod
    path: string
    description?: string
    default: string
    responses: Record<string, unknown>
  }) => { ok: true; id: string } | { ok: false; error: string }
}
```

Replace the two import lines at the top of the file (as they stood after Task 5):

```ts
import type { LoadedEndpoint, LoadError } from '@laqi/core'
import { StateSchema, type LaqiState, type Scenarios } from '@laqi/schema'
```

with:

```ts
import type { LoadedEndpoint, LoadError } from '@laqi/core'
import { EndpointSchema, isHttpMethod, StateSchema, type HttpMethod, type LaqiState, type Scenarios } from '@laqi/schema'
```

(The `Hono` line doesn't change.)

Replace the insertion marker:

```ts
  // Insertion point for Tasks 6–8: new routes go HERE,
  // before this catch-all — never after.
  app.all('*', (c) =>
```

with:

```ts
  app.post('/api/endpoints', async (c) => {
    let raw: unknown
    try {
      raw = await c.req.json()
    } catch {
      return c.json({ error: 'laqi-control-plane', message: 'body is not valid JSON' }, 400)
    }

    if (typeof raw !== 'object' || raw === null) {
      return c.json({ error: 'laqi-control-plane', message: 'body must be an object' }, 400)
    }
    const input = raw as Record<string, unknown>

    if (typeof input.method !== 'string' || !isHttpMethod(input.method.toUpperCase())) {
      return c.json({ error: 'laqi-control-plane', message: `unknown method ${JSON.stringify(input.method)}` }, 400)
    }
    if (typeof input.path !== 'string' || !input.path.startsWith('/')) {
      return c.json({ error: 'laqi-control-plane', message: 'path must start with "/"' }, 400)
    }

    const definition = EndpointSchema.safeParse({
      description: input.description,
      default: input.default,
      responses: input.responses,
    })
    if (!definition.success) {
      return c.json(
        { error: 'laqi-control-plane', message: definition.error.issues.map((i) => i.message).join('; ') },
        400,
      )
    }

    const result = runtime.createEndpoint({
      method: input.method.toUpperCase() as HttpMethod,
      path: input.path,
      description: definition.data.description,
      default: definition.data.default,
      responses: definition.data.responses,
    })

    if (!result.ok) {
      return c.json({ error: 'laqi-control-plane', message: result.error }, 409)
    }

    return c.json({ id: result.id }, 201)
  })

  // Insertion point for Tasks 7–8: new routes go HERE,
  // before this catch-all — never after.
  app.all('*', (c) =>
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `bun run test -- control-plane-app`
Expected: PASS, 14 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/control-plane-app.ts packages/server/src/control-plane-app.test.ts
git commit -m "feat(server): control plane — create an endpoint"
```

---

## Task 7: `packages/server` — control plane: editing and deleting an endpoint

The composite id (`"GET /users/:id"`) travels as a single `:id` path param, encoded with `encodeURIComponent` — verified that `decodeURIComponent(c.req.param('id'))` recovers it exactly.

**Files:**

- Modify: `packages/server/src/control-plane-app.ts`, `packages/server/src/control-plane-app.test.ts`

**Interfaces:**

- Consumes: nothing new
- Produces: `ControlPlaneRuntime` gains `updateEndpoint: (id: string, definition: { description?: string; default: string; responses: Record<string, unknown> }) => { ok: true } | { ok: false; error: string }` and `deleteEndpoint: (id: string) => { ok: true } | { ok: false; error: string }`

- [ ] **Step 1: Write the failing test**

Add to `packages/server/src/control-plane-app.test.ts`:

```ts
describe('PUT /api/endpoints/:id', () => {
  it('updates the endpoint addressed by the URL-encoded id', async () => {
    const updateEndpoint = vi.fn(() => ({ ok: true as const }))
    const app = createControlPlaneApp(makeRuntime({ updateEndpoint }))

    const res = await app.request(`/api/endpoints/${encodeURIComponent('GET /users')}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ default: 'empty', responses: { empty: { status: 200, body: [] } } }),
    })

    expect(res.status).toBe(200)
    expect(updateEndpoint).toHaveBeenCalledWith('GET /users', {
      description: undefined,
      default: 'empty',
      responses: { empty: { status: 200, body: [] } },
    })
  })

  it('returns 404 when the runtime reports the id does not exist', async () => {
    const updateEndpoint = vi.fn(() => ({ ok: false as const, error: 'no endpoint "GET /ghost"' }))
    const app = createControlPlaneApp(makeRuntime({ updateEndpoint }))

    const res = await app.request(`/api/endpoints/${encodeURIComponent('GET /ghost')}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ default: 'ok', responses: { ok: { status: 200 } } }),
    })

    expect(res.status).toBe(404)
  })

  it('rejects an invalid definition with 400', async () => {
    const updateEndpoint = vi.fn()
    const app = createControlPlaneApp(makeRuntime({ updateEndpoint }))

    const res = await app.request(`/api/endpoints/${encodeURIComponent('GET /users')}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ default: 'ok', responses: {} }),
    })

    expect(res.status).toBe(400)
    expect(updateEndpoint).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/endpoints/:id', () => {
  it('deletes the endpoint and returns 204', async () => {
    const deleteEndpoint = vi.fn(() => ({ ok: true as const }))
    const app = createControlPlaneApp(makeRuntime({ deleteEndpoint }))

    const res = await app.request(`/api/endpoints/${encodeURIComponent('GET /users')}`, { method: 'DELETE' })

    expect(res.status).toBe(204)
    expect(deleteEndpoint).toHaveBeenCalledWith('GET /users')
  })

  it('returns 404 when the id does not exist', async () => {
    const deleteEndpoint = vi.fn(() => ({ ok: false as const, error: 'no endpoint "GET /ghost"' }))
    const app = createControlPlaneApp(makeRuntime({ deleteEndpoint }))

    const res = await app.request(`/api/endpoints/${encodeURIComponent('GET /ghost')}`, { method: 'DELETE' })
    expect(res.status).toBe(404)
  })
})
```

And add `updateEndpoint`/`deleteEndpoint` to the `makeRuntime` default:

```ts
    createEndpoint: () => ({ ok: true, id: 'GET /new' }),
    updateEndpoint: () => ({ ok: true }),
    deleteEndpoint: () => ({ ok: true }),
    ...overrides,
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `bun run test -- control-plane-app`
Expected: FAIL — neither route exists yet.

- [ ] **Step 3: Implement**

Add to the type:

```ts
  updateEndpoint: (
    id: string,
    definition: { description?: string; default: string; responses: Record<string, unknown> },
  ) => { ok: true } | { ok: false; error: string }
  deleteEndpoint: (id: string) => { ok: true } | { ok: false; error: string }
```

Replace the insertion marker:

```ts
  // Insertion point for Tasks 7–8: new routes go HERE,
  // before this catch-all — never after.
  app.all('*', (c) =>
```

with:

```ts
  app.put('/api/endpoints/:id', async (c) => {
    const id = decodeURIComponent(c.req.param('id'))

    let raw: unknown
    try {
      raw = await c.req.json()
    } catch {
      return c.json({ error: 'laqi-control-plane', message: 'body is not valid JSON' }, 400)
    }

    const definition = EndpointSchema.safeParse(raw)
    if (!definition.success) {
      return c.json(
        { error: 'laqi-control-plane', message: definition.error.issues.map((i) => i.message).join('; ') },
        400,
      )
    }

    const result = runtime.updateEndpoint(id, definition.data)
    if (!result.ok) {
      return c.json({ error: 'laqi-control-plane', message: result.error }, 404)
    }

    return c.json({ ok: true })
  })

  app.delete('/api/endpoints/:id', (c) => {
    const id = decodeURIComponent(c.req.param('id'))
    const result = runtime.deleteEndpoint(id)

    if (!result.ok) {
      return c.json({ error: 'laqi-control-plane', message: result.error }, 404)
    }

    return c.body(null, 204)
  })

  // Insertion point for Task 8 (SSE): the new route goes HERE,
  // before this catch-all — never after.
  app.all('*', (c) =>
```

> Note: `.pick()` isn't needed here. `EndpointSchema` (Plan 1,
> `packages/schema/src/endpoint.ts`) already has exactly this shape —
> `{ description?, default, responses }` — because `method`/`path` were
> never part of that schema (they travel in the URL, not the definition).
> Using `EndpointSchema.safeParse(raw)` directly also keeps the
> `.superRefine`'s cross-field validation alive (that `default` exists among
> `responses`) for the PUT body, which is strictly better.
>
> **It was verified, by running real Zod 4.3.6, that `.pick()` is NOT an
> option here**: on a schema built with `z.object({...}).superRefine(...)`,
> `.pick()` **throws an exception** ("`.pick()` cannot be used on object
> schemas containing refinements"), it does not silently lose the
> cross-field validation as might seem reasonable to assume. If some future
> change needed a subset of fields from a schema with `.superRefine()`
> chained onto it, the solution is to define a separate schema for that
> subset, never `.pick()`.

- [ ] **Step 4: Run the test and confirm it passes**

Run: `bun run test -- control-plane-app`
Expected: PASS, 19 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/control-plane-app.ts packages/server/src/control-plane-app.test.ts
git commit -m "feat(server): control plane — update and delete an endpoint"
```

## Task 8: `packages/server` — control plane: event stream (SSE)

Verified before writing this plan: `hono/streaming`'s `streamSSE` delivers events correctly on `@hono/node-server`, and `stream.onAbort()` cleans up the bus listener on client disconnect — confirmed under real Node, which is where this repo's tests run.

**Files:**

- Modify: `packages/server/src/control-plane-app.ts`, `packages/server/src/control-plane-app.test.ts`

**Interfaces:**

- Consumes: `type LaqiEvent` (`@laqi/core`, Task 1)
- Produces: `ControlPlaneRuntime` gains `subscribe: (listener: (event: LaqiEvent) => void) => () => void`

- [ ] **Step 1: Write the failing test**

Add to `packages/server/src/control-plane-app.test.ts`:

```ts
describe('GET /events (SSE)', () => {
  it('streams events emitted after the connection opens', async () => {
    let emit: ((event: LaqiEvent) => void) | undefined
    const app = createControlPlaneApp(
      makeRuntime({
        subscribe: (listener) => {
          emit = listener
          return () => {
            emit = undefined
          }
        },
      }),
    )

    const res = await app.request('/events')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/event-stream')

    const reader = res.body!.getReader()
    const decoder = new TextDecoder()

    // The handler only becomes "connected" once it has finished registering
    // the listener — give it one microtask turn before emitting.
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(emit).toBeDefined()

    emit!({ type: 'endpoints-changed', endpointCount: 5 })

    const { value } = await reader.read()
    const text = decoder.decode(value)
    expect(text).toContain('event: endpoints-changed')
    expect(text).toContain(JSON.stringify({ type: 'endpoints-changed', endpointCount: 5 }))

    await reader.cancel()
  })

  it('unsubscribes when the client disconnects', async () => {
    let unsubscribed = false
    const app = createControlPlaneApp(
      makeRuntime({
        subscribe: () => () => {
          unsubscribed = true
        },
      }),
    )

    const res = await app.request('/events')
    const reader = res.body!.getReader()
    await new Promise((resolve) => setTimeout(resolve, 10))

    await reader.cancel()
    // 150ms: 5x the SSE handler's 30ms poll interval, plenty of margin so
    // this isn't a flaky test from sitting right at the edge.
    await new Promise((resolve) => setTimeout(resolve, 150))

    expect(unsubscribed).toBe(true)
  })
})
```

And add `subscribe` to the `makeRuntime` default and import `LaqiEvent`:

```ts
import type { LaqiEvent, LoadedEndpoint, LoadError } from '@laqi/core'
```

```ts
    updateEndpoint: () => ({ ok: true }),
    deleteEndpoint: () => ({ ok: true }),
    subscribe: () => () => {},
    ...overrides,
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `bun run test -- control-plane-app`
Expected: FAIL — `/events` doesn't exist, falls through to the catch-all (404, not 200 with `text/event-stream`).

- [ ] **Step 3: Implement**

Replace the two import lines at the top of the file (as they stood after Task 6):

```ts
import type { LoadedEndpoint, LoadError } from '@laqi/core'
import { EndpointSchema, isHttpMethod, StateSchema, type HttpMethod, type LaqiState, type Scenarios } from '@laqi/schema'
import { Hono } from 'hono'
```

with (adds `LaqiEvent` to the first import, and a new line for `streamSSE`):

```ts
import type { LaqiEvent, LoadedEndpoint, LoadError } from '@laqi/core'
import { EndpointSchema, isHttpMethod, StateSchema, type HttpMethod, type LaqiState, type Scenarios } from '@laqi/schema'
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
```

Add to the type:

```ts
  subscribe: (listener: (event: LaqiEvent) => void) => () => void
```

Replace the insertion marker:

```ts
  // Insertion point for Task 8 (SSE): the new route goes HERE,
  // before this catch-all — never after.
  app.all('*', (c) =>
```

with:

```ts
  app.get('/events', (c) =>
    streamSSE(c, async (stream) => {
      let closed = false
      stream.onAbort(() => {
        closed = true
      })

      const unsubscribe = runtime.subscribe((event) => {
        void stream.writeSSE({ event: event.type, data: JSON.stringify(event) })
      })

      try {
        // 30ms, not 1000ms: the loop exists only to keep the generator
        // alive while the connection stays open; the interval is the
        // maximum latency before noticing an abort and unsubscribing.
        // Verified while running it: at 1000ms, the disconnect test (which
        // only waits 150ms after the cancel) failed deterministically even
        // though onAbort fired correctly — the real cleanup happened, just
        // late.
        while (!closed) {
          await stream.sleep(30)
        }
      } finally {
        unsubscribe()
      }
    }),
  )

  // Insertion point for future routes: they go HERE, before this
  // catch-all — never after.
  app.all('*', (c) =>
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `bun run test -- control-plane-app`
Expected: PASS, 21 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/control-plane-app.ts packages/server/src/control-plane-app.test.ts
git commit -m "feat(server): control plane — live SSE stream of requests, reloads and errors"
```

---

## Task 9: `packages/server` — `mock-app.ts` emits request events

**Files:**

- Modify: `packages/server/src/mock-app.ts`, `packages/server/src/mock-app.test.ts`, `packages/server/src/index.ts`

**Interfaces:**

- Consumes: `type LaqiEvent` (`@laqi/core`, Task 1)
- Produces: `MockRuntime` gains `onRequest?: (event: LaqiEvent) => void`, called after resolving every response (success or 500), never on the catch-all's 404 (that one doesn't correspond to any declared endpoint)

- [ ] **Step 1: Write the failing test**

Add to `packages/server/src/mock-app.test.ts`:

```ts
describe('onRequest', () => {
  it('fires with method, path, status, resolved layer/name and timing after a successful response', async () => {
    const onRequest = vi.fn()
    const app = makeApp(undefined, undefined, { onRequest })

    await app.request('/users')

    expect(onRequest).toHaveBeenCalledTimes(1)
    const event = onRequest.mock.calls[0]![0]
    expect(event).toMatchObject({
      type: 'request',
      method: 'GET',
      path: '/users',
      status: 200,
      resolvedName: 'ok',
      resolvedLayer: 'default',
    })
    expect(typeof event.ms).toBe('number')
    expect(event.ms).toBeGreaterThanOrEqual(0)
  })

  it('fires on a resolution failure too (500), not just on success', async () => {
    const onRequest = vi.fn()
    const state = { scenario: null, overrides: { 'GET /users': 'ghost' } }
    const app = makeApp(state, undefined, { onRequest })

    await app.request('/users')

    expect(onRequest).toHaveBeenCalledTimes(1)
    expect(onRequest.mock.calls[0]![0]).toMatchObject({ type: 'request', status: 500 })
  })

  it('does not fire for a request that matches no endpoint at all', async () => {
    const onRequest = vi.fn()
    const app = makeApp(undefined, undefined, { onRequest })

    await app.request('/typo')

    expect(onRequest).not.toHaveBeenCalled()
  })

  it('is optional — omitting it does not throw', async () => {
    const app = makeApp()
    const res = await app.request('/users')
    expect(res.status).toBe(200)
  })
})
```

In `packages/server/src/mock-app.test.ts`, replace the `makeApp` helper (line 41 of the current file):

```ts
function makeApp(state: LaqiState = { scenario: null, overrides: {} }, scenarios: Scenarios = {}) {
  const { table } = buildRouteTable(endpoints)
  const runtime: MockRuntime = { table, scenarios, getState: () => state, cors: '*' }
  return createMockApp(runtime)
}
```

with:

```ts
function makeApp(
  state: LaqiState = { scenario: null, overrides: {} },
  scenarios: Scenarios = {},
  overrides: Partial<MockRuntime> = {},
) {
  const { table } = buildRouteTable(endpoints)
  const runtime: MockRuntime = { table, scenarios, getState: () => state, cors: '*', ...overrides }
  return createMockApp(runtime)
}
```

Every existing call site (`makeApp()`, `makeApp(state)`, `makeApp(state, scenarios)`) keeps working the same, because `overrides` is optional with a default of `{}`.

- [ ] **Step 2: Run the test and confirm it fails**

Run: `bun run test -- mock-app`
Expected: FAIL — `onRequest` isn't a recognized field, or it's simply never called (the `expect(onRequest).toHaveBeenCalledTimes(1)` calls fail with 0 calls).

- [ ] **Step 3: Implement**

In `packages/server/src/mock-app.ts`, add the import and the field on the type:

```ts
import type { LaqiEvent } from '@laqi/core'
```

```ts
export type MockRuntime = {
  table: RouteTable
  scenarios: Scenarios
  /** A function, not a value: state changes without the route table changing. */
  getState: () => LaqiState
  cors: LaqiConfig['cors']
  /** Optional: if present, called after resolving every response (success or 500). */
  onRequest?: (event: LaqiEvent) => void
}
```

Replace the full body of `registerEndpoint` (the handler that registers each endpoint, without touching anything before or after it in the file — the OPTIONS/cors split and the 404 catch-all stay untouched). The current block is:

```ts
  const registerEndpoint = (endpoint: LoadedEndpoint) => {
    app.on(endpoint.method, endpoint.path, async (c) => {
      const resolution = resolveResponse({
        endpoint,
        state: runtime.getState(),
        scenarios: runtime.scenarios,
        headerResponse: c.req.header(RESPONSE_HEADER),
        headerScenario: c.req.header(SCENARIO_HEADER),
      })

      // A selector that doesn't exist is an explicit 500. Never a hanging request.
      if (!resolution.ok) {
        c.header(RESOLVED_HEADER, formatResolvedHeader(resolution))
        return c.json({ error: 'laqi', endpoint: endpoint.id, message: resolution.message }, 500)
      }

      const { response } = resolution

      if (response.delay) {
        await new Promise((resolve) => setTimeout(resolve, response.delay))
      }

      for (const [name, value] of Object.entries(response.headers ?? {})) {
        c.header(name, value)
      }

      // Set AFTER the mock's headers: one declared as
      // "X-Laqi-Resolved" can never lie about which layer decided.
      c.header(RESOLVED_HEADER, formatResolvedHeader(resolution))

      if (response.body === undefined) {
        return c.body(null, response.status as StatusCode)
      }

      // structuredClone: the served body is never the loaded reference.
      return c.json(structuredClone(response.body), response.status as ContentfulStatusCode)
    })
  }
```

Replace it with:

```ts
  const registerEndpoint = (endpoint: LoadedEndpoint) => {
    app.on(endpoint.method, endpoint.path, async (c) => {
      const startedAt = Date.now()
      const resolution = resolveResponse({
        endpoint,
        state: runtime.getState(),
        scenarios: runtime.scenarios,
        headerResponse: c.req.header(RESPONSE_HEADER),
        headerScenario: c.req.header(SCENARIO_HEADER),
      })

      const emit = (status: number) => {
        runtime.onRequest?.({
          type: 'request',
          method: endpoint.method,
          path: endpoint.path,
          status,
          resolvedName: resolution.name,
          resolvedLayer: resolution.layer,
          ms: Date.now() - startedAt,
        })
      }

      // A selector that doesn't exist is an explicit 500. Never a hanging request.
      if (!resolution.ok) {
        c.header(RESOLVED_HEADER, formatResolvedHeader(resolution))
        emit(500)
        return c.json({ error: 'laqi', endpoint: endpoint.id, message: resolution.message }, 500)
      }

      const { response } = resolution

      if (response.delay) {
        await new Promise((resolve) => setTimeout(resolve, response.delay))
      }

      for (const [name, value] of Object.entries(response.headers ?? {})) {
        c.header(name, value)
      }

      // Set AFTER the mock's headers: one declared as
      // "X-Laqi-Resolved" can never lie about which layer decided.
      c.header(RESOLVED_HEADER, formatResolvedHeader(resolution))
      emit(response.status)

      if (response.body === undefined) {
        return c.body(null, response.status as StatusCode)
      }

      // structuredClone: the served body is never the loaded reference.
      return c.json(structuredClone(response.body), response.status as ContentfulStatusCode)
    })
  }
```

The rest of the file (Plan 1's OPTIONS/cors split, the 404 catch-all) doesn't change.

- [ ] **Step 4: Run the test and confirm it passes**

Run: `bun run test -- mock-app`
Expected: PASS. Also confirm the rest of `mock-app.test.ts`'s tests (Plan 1's) still pass, untouched.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/mock-app.ts packages/server/src/mock-app.test.ts
git commit -m "feat(server): mock-app emits a request event after resolving every response"
```

- [ ] **Step 6: Export `control-plane-app` from the package index**

```ts
// packages/server/src/index.ts
export * from './mock-app'
export * from './control-plane-app'
```

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/index.ts
git commit -m "feat(server): export the control plane app from @laqi/server"
```

## Task 10: `apps/cli` — composing control plane + mock app, wiring up the bus

This is the integration task: it brings everything above together in the real server. It reuses Plan 1's hot-swap without touching its shape — it just makes `buildApp()` build two apps instead of one, and `reload()` also emit events.

**Files:**

- Modify: `apps/cli/src/serve.ts`, `apps/cli/src/serve.test.ts`

**Interfaces:**

- Consumes: `EventBus`, `type LaqiEvent`, `createEndpointInFile`, `updateEndpointInFile`, `deleteEndpointFromFile`, `type WriteResult` (`@laqi/core`, Tasks 1–3); `createControlPlaneApp`, `type ControlPlaneRuntime`, `createMockApp` (`@laqi/server`, Tasks 4–9); `formatEndpointId`, `type HttpMethod` (`@laqi/schema`, Plan 1)
- Produces: `ServeHandle`'s shape doesn't change (same fields: `port`, `host`, `reload`, `current`, `close`) — but now `app` (internal, not exported) serves mocks and control plane at once

- [ ] **Step 1: Write the failing test**

Add to `apps/cli/src/serve.test.ts` (after Plan 1's existing tests):

```ts
describe('control plane, mounted under /__laqi', () => {
  it('lists the loaded endpoints', async () => {
    writeMocks({ 'GET /users': { default: 'ok', responses: { ok: { status: 200, body: [] } } } })
    handle = await startServer({ root, config })

    const res = await get('/__laqi/api/endpoints')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { id: string }[]
    expect(body.map((e) => e.id)).toEqual(['GET /users'])
  })

  it('flips the live response via PUT /api/state, and the mock reflects it immediately', async () => {
    writeMocks({
      'GET /users': {
        default: 'ok',
        responses: { ok: { status: 200, body: [] }, boom: { status: 500, body: {} } },
      },
    })
    handle = await startServer({ root, config })

    const put = await fetch(`http://127.0.0.1:${handle!.port}/__laqi/api/state`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scenario: null, overrides: { 'GET /users': 'boom' } }),
    })
    expect(put.status).toBe(200)

    const res = await get('/users')
    expect(res.status).toBe(500)
    expect(res.headers.get('X-Laqi-Resolved')).toBe('boom (state)')
  })

  it('creates an endpoint via POST, and it is immediately servable — no restart, no wait for the watcher', async () => {
    writeMocks({ 'GET /users': { default: 'ok', responses: { ok: { status: 200, body: [] } } } })
    handle = await startServer({ root, config })

    const post = await fetch(`http://127.0.0.1:${handle!.port}/__laqi/api/endpoints`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        method: 'GET',
        path: '/orders',
        default: 'ok',
        responses: { ok: { status: 200, body: [] } },
      }),
    })
    expect(post.status).toBe(201)

    const res = await get('/orders')
    expect(res.status).toBe(200)
  })

  it('updates an endpoint via PUT, immediately reflected', async () => {
    writeMocks({
      'GET /users': { default: 'ok', responses: { ok: { status: 200, body: [{ id: 1 }] } } },
    })
    handle = await startServer({ root, config })

    const put = await fetch(
      `http://127.0.0.1:${handle!.port}/__laqi/api/endpoints/${encodeURIComponent('GET /users')}`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ default: 'ok', responses: { ok: { status: 200, body: [] } } }),
      },
    )
    expect(put.status).toBe(200)

    const res = await get('/users')
    expect(await res.json()).toEqual([])
  })

  it('deletes an endpoint via DELETE, immediately gone', async () => {
    writeMocks({
      'GET /users': { default: 'ok', responses: { ok: { status: 200, body: [] } } },
      'GET /orders': { default: 'ok', responses: { ok: { status: 200, body: [] } } },
    })
    handle = await startServer({ root, config })

    const del = await fetch(
      `http://127.0.0.1:${handle!.port}/__laqi/api/endpoints/${encodeURIComponent('GET /orders')}`,
      { method: 'DELETE' },
    )
    expect(del.status).toBe(204)

    expect((await get('/orders')).status).toBe(404)
    expect((await get('/users')).status).toBe(200)
  })

  it('streams a request event over SSE when a mock is hit', async () => {
    writeMocks({ 'GET /users': { default: 'ok', responses: { ok: { status: 200, body: [] } } } })
    handle = await startServer({ root, config })

    const sse = await fetch(`http://127.0.0.1:${handle!.port}/__laqi/events`)
    const reader = sse.body!.getReader()
    const decoder = new TextDecoder()

    await new Promise((resolve) => setTimeout(resolve, 20))
    await get('/users')

    const { value } = await reader.read()
    const text = decoder.decode(value)
    expect(text).toContain('event: request')
    expect(text).toContain('"path":"/users"')

    await reader.cancel()
  })

  it('a mock endpoint can never be created under the reserved /__laqi prefix', async () => {
    handle = await startServer({ root, config })

    const post = await fetch(`http://127.0.0.1:${handle!.port}/__laqi/api/endpoints`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        method: 'GET',
        path: '/__laqi/panel',
        default: 'ok',
        responses: { ok: { status: 200, body: {} } },
      }),
    })

    // The creation route itself does not validate the reserved prefix (that's
    // parseEndpointKey's job, at LOAD time, Plan 1) — but the file does get
    // written, and the immediate reload must report the LOAD FAILED error
    // instead of registering the endpoint.
    expect(post.status).toBe(201)
    const status = await (await get('/__laqi/api/status')).json()
    expect((status as { errors: unknown[] }).errors.length).toBeGreaterThan(0)
    expect((await get('/__laqi/panel')).status).not.toBe(200)
  })
})
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `bun run test -- serve`
Expected: FAIL — every request to `/__laqi/*` returns 404 (the mock-app's `app.all('*', ...)`, because the control plane isn't mounted yet).

- [ ] **Step 3: Implement**

Replace the full contents of `apps/cli/src/serve.ts`:

```ts
// apps/cli/src/serve.ts
import { join } from 'node:path'
import { serve, type ServerType } from '@hono/node-server'
import {
  createEndpointInFile,
  deleteEndpointFromFile,
  EventBus,
  StateStore,
  updateEndpointInFile,
  type WriteResult,
} from '@laqi/core'
import { formatEndpointId, isHttpMethod, type HttpMethod, type LaqiConfig } from '@laqi/schema'
import { createControlPlaneApp, createMockApp, type ControlPlaneRuntime } from '@laqi/server'
import { Hono } from 'hono'
import { buildRuntime, type Runtime } from './runtime'

export type ServeHandle = {
  port: number
  host: string
  /** Rebuilds the Hono app. The process and the socket are NOT touched. */
  reload: () => Runtime
  current: () => Runtime
  close: () => Promise<void>
}

export async function startServer(options: {
  root: string
  config: LaqiConfig
}): Promise<ServeHandle> {
  const { root, config } = options
  const store = new StateStore(root)
  const bus = new EventBus()

  let runtime = buildRuntime(root, config)
  let app: Hono = buildApp()

  function reload(): Runtime {
    runtime = buildRuntime(root, config)
    app = buildApp()
    bus.emit({ type: 'endpoints-changed', endpointCount: runtime.table.endpoints.length })
    for (const error of runtime.errors) {
      bus.emit({
        type: 'error',
        file: error.file,
        line: error.line,
        col: error.col,
        message: error.message,
        excerpt: error.excerpt,
      })
    }
    return runtime
  }

  function targetFileForNewEndpoint(): string {
    return runtime.source === 'file' ? config.file : join(config.dir, 'api.json')
  }

  function buildApp(): Hono {
    const mockApp = createMockApp({
      table: runtime.table,
      scenarios: runtime.scenarios,
      // Read on every request: the panel changes state without touching files.
      getState: () => store.read(),
      cors: config.cors,
      onRequest: (event) => bus.emit(event),
    })

    const controlPlaneRuntime: ControlPlaneRuntime = {
      getEndpoints: () => runtime.table.endpoints,
      getState: () => store.read(),
      setState: (state) => store.write(state),
      getScenarios: () => runtime.scenarios,
      getStatus: () => ({
        watching: runtime.source === 'file' ? config.file : config.dir,
        endpointCount: runtime.table.endpoints.length,
        address: `${config.host}:${config.port}`,
        errors: runtime.errors,
      }),
      createEndpoint: (input) => {
        const method = input.method.toUpperCase()
        if (!isHttpMethod(method)) return { ok: false, error: `unknown method ${JSON.stringify(input.method)}` }

        const id = formatEndpointId(method as HttpMethod, input.path)
        const result: WriteResult = createEndpointInFile({
          root,
          file: targetFileForNewEndpoint(),
          id,
          definition: { description: input.description, default: input.default, responses: input.responses },
        })

        if (!result.ok) return result
        reload()
        return { ok: true, id }
      },
      updateEndpoint: (id, definition) => {
        const existing = runtime.table.byId.get(id)
        if (!existing) return { ok: false, error: `no endpoint with id ${JSON.stringify(id)}` }

        const result = updateEndpointInFile({ root, file: existing.file, id, definition })
        if (result.ok) reload()
        return result
      },
      deleteEndpoint: (id) => {
        const existing = runtime.table.byId.get(id)
        if (!existing) return { ok: false, error: `no endpoint with id ${JSON.stringify(id)}` }

        const result = deleteEndpointFromFile({ root, file: existing.file, id })
        if (result.ok) reload()
        return result
      },
      subscribe: (listener) => bus.subscribe(listener),
    }
    const controlPlaneApp = createControlPlaneApp(controlPlaneRuntime)

    const top = new Hono()
    top.route('/__laqi', controlPlaneApp)
    top.route('/', mockApp)
    return top
  }

  const server: ServerType = await new Promise((resolve, reject) => {
    const instance = serve(
      {
        // The indirection is the point: `app` is mutable, the server is not.
        fetch: (request: Request) => app.fetch(request),
        port: config.port,
        hostname: config.host,
      },
      () => resolve(instance),
    )
    // Without this, a port already in use (EADDRINUSE) never fires the
    // success callback and the promise hangs forever, silently.
    instance.on('error', reject)
  })

  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : config.port

  return {
    port,
    host: config.host,
    current: () => runtime,
    reload,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      }),
  }
}
```

> Note on Task 9's `onRequest`: `createMockApp` already declares it optional
> (`onRequest?: (event: LaqiEvent) => void`) — passing it here as
> `(event) => bus.emit(event)` is valid because `LaqiEvent` (the type
> `mock-app.ts` emits) and the one `EventBus.emit` expects are the same
> type, re-exported from `@laqi/core`.

> Note on the "cannot be created under `/__laqi`" test: the control plane's
> creation route (Task 6) does not validate the reserved prefix — only
> `parseEndpointKey`, which runs at LOAD time (`loadMocks`, Plan 1), does.
> This is intentional: validation lives in one place (the loader), not
> duplicated in every writer. The result is the same — the endpoint never
> ends up servable — but the error surfaces in `/api/status`, not in the
> `POST` response. Plan 2b must show that error in the red band (F8) if the
> user tries this from the editor.

- [ ] **Step 4: Run the test and confirm it passes**

Run: `bun run test -- serve`
Expected: PASS. Also run the full suite: `bun run test` (unfiltered) and `bun run check-types`, since this task modifies a file other parts of the system already use (`apps/cli/src/index.ts` imports `startServer` with no change to its signature, so nothing should break — confirm it).

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/serve.ts apps/cli/src/serve.test.ts
git commit -m "feat(cli): mount the control plane alongside the mock server, wire the event bus"
```

## Task 11: Manual end-to-end smoke test

No code changes — this is the final, by-hand verification that the whole control plane works together on a real server, including SSE receiving events from a real `curl` client while another client fires requests.

**Files:** none.

- [ ] **Step 1: Spin up a test project**

```bash
mkdir -p /tmp/laqi-cp-smoke/laqi && cd /tmp/laqi-cp-smoke
cat > laqi/api.json <<'JSON'
{
  "GET /users": {
    "default": "ok",
    "responses": {
      "ok":   { "status": 200, "body": [{ "id": 1, "name": "Ada" }] },
      "boom": { "status": 500, "body": { "code": "INTERNAL" } }
    }
  }
}
JSON
bun <path-to-repo>/apps/cli/src/index.ts &
```

- [ ] **Step 2: Connect to the SSE stream in one terminal and leave it running**

```bash
curl -N http://127.0.0.1:8000/__laqi/events
```

- [ ] **Step 3: In another terminal, exercise the control plane**

```bash
# read
curl -s http://127.0.0.1:8000/__laqi/api/endpoints | jq
curl -s http://127.0.0.1:8000/__laqi/api/state | jq

# flip the state
curl -s -X PUT http://127.0.0.1:8000/__laqi/api/state \
  -H 'content-type: application/json' \
  -d '{"scenario":null,"overrides":{"GET /users":"boom"}}'
curl -i http://127.0.0.1:8000/users   # -> 500, X-Laqi-Resolved: boom (state)

# create
curl -s -X POST http://127.0.0.1:8000/__laqi/api/endpoints \
  -H 'content-type: application/json' \
  -d '{"method":"GET","path":"/orders","default":"ok","responses":{"ok":{"status":200,"body":[]}}}'
curl -i http://127.0.0.1:8000/orders   # -> 200, without restarting the process

# edit
curl -s -X PUT "http://127.0.0.1:8000/__laqi/api/endpoints/GET%20%2Forders" \
  -H 'content-type: application/json' \
  -d '{"default":"ok","responses":{"ok":{"status":200,"body":[{"n":1}]}}}'
curl -s http://127.0.0.1:8000/orders   # -> [{"n":1}]

# delete
curl -i -X DELETE "http://127.0.0.1:8000/__laqi/api/endpoints/GET%20%2Forders"
curl -i http://127.0.0.1:8000/orders   # -> 404
```

- [ ] **Step 4: Check the SSE terminal (Step 2)**

Expected: for every `curl /users` and `/orders` above, a `event: request` line with the correct path and status; for every create/update/delete, a `event: endpoints-changed` line with the updated `endpointCount`.

- [ ] **Step 5: Confirm nothing broke the file hot-reload**

```bash
echo '{"GET /health":{"default":"ok","responses":{"ok":{"status":200,"body":{}}}}}' > laqi/health.json
sleep 1
curl -i http://127.0.0.1:8000/health   # -> 200, without having gone through the control plane
```

- [ ] **Step 6: Shut the server down cleanly**

```bash
kill %1
```

- [ ] **Step 7: Run the full suite one last time**

```bash
cd <path-to-repo>
bun run test && bun run check-types && bun run lint
```

Expected: all green.

---

## Out of scope for this plan

- **The tunnel block** (making sure `/__laqi/*` never reaches the public URL). This plan only delivers the structural separation (`createControlPlaneApp` ≠ `createMockApp`) that makes it possible. The actual mechanism (cloudflared, a proxy, whatever) is Plan 4.
- **`share-changed`** as a bus event — belongs to Plan 4; nothing exists yet to emit it.
- **Control plane authentication.** Anyone who reaches the control plane can read and write mocks — it has no token, no login. The two concrete ways of reaching it unintentionally are mitigated: **(a) a non-loopback `--host`** (LAN/mobile testing, a real case since Plan 1) — the control plane is not mounted unless `config.host` is `127.0.0.1`/`localhost`; the mock server keeps listening on the configured host, only `/__laqi` is withdrawn. **(b) a cross-origin request from the browser** — any page the developer visits while `laqi` is running could attempt a "simple request" CORS `POST` (no preflight) against `127.0.0.1:PORT/__laqi/api/endpoints`; the control plane rejects any write whose `Origin` header doesn't match the server's own origin. _(Note: this item's original wording said "acceptable because it currently only listens locally" — that premise was false in both ways above, found and fixed in this plan's final review; see the session ledger for detail.)_ Neither mitigation is real authentication — Plan 4, when it adds `--share`, is still the one that decides whether the control plane needs its own token when sharing mode is active (ADR-0007 already requires one for the mock server; the control plane should never even be reachable from there).
- **Authoring scenarios** (creating/editing `scenarios.json`) — [ADR-0008](/decisions/0008-multifile-and-names/) already decided that's done by hand or via MCP (Plan 3), never from the panel. `GET /api/scenarios` is deliberately read-only.
- **The web editor itself** (`packages/editor`) — that's Plan 2b, which consumes this API.

## Definition of done

- [ ] `bun run test` green: 11 tasks, 50 new tests (7 events + 11 writer + 21 control-plane-app + 4 mock-app + 7 serve) on top of the 122 that already existed — 172 total
- [ ] `bun run check-types` and `bun run lint` with no errors
- [ ] `GET /__laqi/api/endpoints`, `GET`/`PUT /__laqi/api/state`, `GET /__laqi/api/scenarios`, `GET /__laqi/api/status` respond correctly, mounted alongside the mock server
- [ ] `POST`/`PUT`/`DELETE /__laqi/api/endpoints[/:id]` write back to the files and the change is servable **without restarting the process**
- [ ] `GET /__laqi/events` delivers live SSE: `request` for every mock served, `endpoints-changed` and `error` after every reload (whether from a control-plane write or a manual file edit)
- [ ] No mock can register under `/__laqi` (already guaranteed since Plan 1, re-verified here with an integration test)
- [ ] `createControlPlaneApp` and `createMockApp` remain two genuinely separate Hono apps — never merged into a single routes file
