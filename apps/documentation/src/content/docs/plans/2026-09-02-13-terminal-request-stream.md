---
title: "Plan 13 — Terminal output, stage 2: the request stream and the four keys"
---

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the terminal show requests as they land, and bind the four keys the start screen has been unable to advertise — `o` panel, `s` share, `c` clear, `q` quit — plus mark the requests that arrived through the public URL.

**Architecture:** The stream is a subscriber, not a new code path: `EventBus` already carries every request to the panel over SSE, and `ServeHandle.subscribe` is already exported. `@laqi/tui` gains one pure formatter (event in, string out, no I/O) and `apps/cli` gains one module that owns raw-mode stdin and restores it on every exit path. Nothing on the request path changes except one added field. Sharing becomes togglable at runtime, which means the second listener has to be startable after boot rather than only at boot.

**Tech Stack:** TypeScript, `process.stdin` raw mode (no dependency — `apps/cli/src/package.test.ts` pins the published dependency list and this plan does not change it), Vitest.

**Spec:** `apps/documentation/src/content/docs/design/terminal-output.md` — its **Shortcuts** table, its **Sequencing** step 2, and the `via public` half of step 3. Stage 1 shipped in Plan 8 / PR #21.

## Global Constraints

- **English everywhere** in code, comments, identifiers, test names, commits and docs (ADR-0009).
- **No new published dependency.** `apps/cli/src/package.test.ts` asserts the exact dependency list; if this plan makes that test fail, the plan is wrong, not the test.
- **The formatter is pure.** Everything in `@laqi/tui` takes values and returns a string. No `process`, no `stdout`, no clock read. That is the invariant stage 1 established, and it is what makes the screens testable without a terminal.
- **The terminal is always restored.** Raw mode off, `stdin` paused, listeners removed — on `q`, on `^C`, on `SIGTERM`, and on the fatal-reload path that calls `process.exit` from inside the watcher. A tool that leaves a shell with echo disabled is a tool people uninstall.
- **`^C` still works in raw mode.** Raw mode stops the terminal driver from turning byte `0x03` into `SIGINT`; the key handler has to call the same shutdown the signal handler does. Losing `^C` is the single worst outcome of this plan.
- **No TTY, no keys.** When `process.stdin.isTTY` is false — piped, under `npm run` with stdio inherited from a non-tty, in CI, in an agent harness — raw mode is never entered and the keys line is not printed. Printing `press o panel` where no key is bound is the lie stage 1 refused to tell.
- **The stream is quiet in a pipe but not absent.** Rows still print without a TTY (they are useful in a log); colour is already off there via `detectLevel`.
- **A request row costs nothing measurable.** The subscriber formats and writes; it does not allocate per-request state, keep history, or touch the disk. This is on the path whose whole job is to be fast.
- **`c` clears the terminal only.** Not the server, not the counters, not the panel's log. The goodbye summary after a `c` still reports the whole session.
- **TDD throughout.** `bun run test`, or `bunx vitest run <path>` to scope.
- **Follow existing conventions:** Conventional Commits, `bun run check:ci` clean before every commit, PR-only workflow.
- **Out of scope, deliberately:** the **QR code** half of stage 3. It needs either a new published dependency or a Reed-Solomon encoder written into `@laqi/tui`, and that is a decision with its own trade-off, not a task to slip into a plan about keyboard handling. This plan ships `via public`; the QR gets its own plan. Say so in the PR.

---

## File structure

```
packages/core/src/
└── events.ts                  # modify: `via` on the request event

packages/server/src/
└── public-app.ts              # modify: tag the events it serves as public

packages/tui/src/
├── stream.ts                  # requestRow() and keysLine(), both pure
├── stream.test.ts
└── index.ts                   # modify: export them

apps/cli/src/
├── keys.ts                    # raw mode, the four bindings, the restore
├── keys.test.ts
├── open-browser.ts            # moved up from init/, now two callers
├── serve.ts                   # modify: start/stop the public listener
└── index.ts                   # modify: wire the stream, the keys, the keys line
```

`stream.ts` knows how a request looks and nothing about terminals. `keys.ts` knows about terminals and nothing about requests. Neither knows about the other.

---

## Task 1: `requestRow` and `keysLine`

**Files:**

- Create: `packages/tui/src/stream.ts`
- Create: `packages/tui/src/stream.test.ts`
- Modify: `packages/tui/src/index.ts`

**Interfaces:**

- Consumes: `usableWidth`, `displayWidth`, `LABEL_WIDTH` from `./layout`; `paint`, `Level`, `Token` from `./palette`.
- Produces:
  - `type RequestRow = { time: string; method: string; path: string; status: number; resolvedName?: string; resolvedLayer?: string; ms: number; matched: boolean; viaPublic?: boolean }`
  - `function requestRow(row: RequestRow, level: Level, columns?: number): string`
  - `function keysLine(level: Level, sharing: boolean): string`

**The row format is new.** `terminal-output.md` mocks up Start, Failures and Goodbye but never the stream, so this task designs it. The brief it has to satisfy: the same vocabulary and order as the panel's log row (`RequestLog.tsx` — time, method, path, status, resolved, ms), the label column of the start screen so the two blocks line up, and a no-route row that is impossible to miss.

```
14:32:07    GET    /todos                  200   ok · default          2ms
14:32:09    GET    /todos/99               404   not-found · state     1ms
14:32:11    POST   /orders                 404   no matching route     0ms
14:32:14    GET    /todos          public  200   ok · default          3ms
```

- [ ] **Step 1: Write the failing test**

```ts
// packages/tui/src/stream.test.ts
import { describe, expect, it } from 'vitest'
import { keysLine, requestRow, type RequestRow } from './stream'

const base: RequestRow = {
  time: '14:32:07',
  method: 'GET',
  path: '/todos',
  status: 200,
  resolvedName: 'ok',
  resolvedLayer: 'default',
  ms: 2,
  matched: true,
}

const plain = (row: Partial<RequestRow> = {}, columns = 100) =>
  requestRow({ ...base, ...row }, 'none', columns)

describe('requestRow', () => {
  it("prints the panel log's vocabulary, in the panel log's order", () => {
    expect(plain()).toMatch(/14:32:07.*GET.*\/todos.*200.*ok · default.*2ms/)
  })

  it('says what happened rather than showing a blank resolution on a no-route', () => {
    // The no-route row is the one that catches a typo'd path in the
    // frontend. An empty resolution column would bury it.
    expect(
      plain({ matched: false, status: 404, resolvedName: undefined, resolvedLayer: undefined }),
    ).toContain('no matching route')
  })

  it('never renders the string "undefined"', () => {
    expect(
      plain({ resolvedName: undefined, resolvedLayer: undefined, matched: false }),
    ).not.toContain('undefined')
  })

  it('aligns the columns across rows of different lengths', () => {
    const short = plain({ method: 'GET', path: '/a' })
    const long = plain({ method: 'DELETE', path: '/a' })
    expect(short.indexOf('/a')).toBe(long.indexOf('/a'))
  })

  it('truncates a long path instead of wrapping the row', () => {
    // A wrapped row destroys the column alignment that makes the stream
    // scannable, and the path is the only field here that varies without
    // limit.
    const row = plain({ path: `/${'x'.repeat(200)}` }, 80)
    expect(row.split('\n')).toHaveLength(1)
    expect(row).toContain('…')
  })

  it('keeps the time, status and duration even when the path is truncated', () => {
    const row = plain({ path: `/${'x'.repeat(200)}` }, 80)
    expect(row).toContain('14:32:07')
    expect(row).toContain('200')
    expect(row).toContain('2ms')
  })

  it('marks a request that arrived through the public URL', () => {
    expect(plain({ viaPublic: true })).toContain('public')
  })

  it('says nothing about the transport for a local request', () => {
    expect(plain({ viaPublic: false })).not.toContain('public')
  })

  it('paints the status by class when colour is on', () => {
    // Same second scan dimension the panel uses: you find the 500 by its
    // colour before you have read the path.
    const ok = requestRow({ ...base, status: 200 }, 'truecolor', 100)
    const server = requestRow({ ...base, status: 500 }, 'truecolor', 100)
    expect(ok).not.toBe(server.replace('500', '200'))
  })

  it('emits no escape codes at level none', () => {
    expect(plain()).not.toMatch(/\u001b\[/)
  })
})

describe('keysLine', () => {
  it('names all four keys', () => {
    const line = keysLine('none', false)
    for (const key of ['o', 's', 'c', 'q']) expect(line).toContain(key)
  })

  it('reads "share" when sharing is off and "stop sharing" when it is on', () => {
    // The key toggles, so the label has to say which way it will go — a
    // fixed "share" while a tunnel is open tells you to do what you did.
    expect(keysLine('none', false)).toContain('share')
    expect(keysLine('none', true)).toContain('stop sharing')
  })

  it("indents to the start screen's value column, so the blocks line up", () => {
    expect(keysLine('none', false).startsWith(' '.repeat(12))).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run packages/tui/src/stream.test.ts`
Expected: FAIL — `Failed to resolve import "./stream"`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/tui/src/stream.ts
import { displayWidth, LABEL_WIDTH, usableWidth } from './layout'
import { paint, type Level, type Token } from './palette'

export type RequestRow = {
  /** `HH:MM:SS`. Formatted by the caller, which owns the clock. */
  time: string
  method: string
  /** The requested path, not the route pattern. */
  path: string
  status: number
  resolvedName?: string
  resolvedLayer?: string
  ms: number
  /** False when no route matched — the row that catches a typo'd path. */
  matched: boolean
  /** True when the request arrived through the tunnel rather than locally. */
  viaPublic?: boolean
}

const TIME_WIDTH = 8
const METHOD_WIDTH = 6
const VIA_WIDTH = 7
const STATUS_WIDTH = 3
const RESOLVED_WIDTH = 22
const MS_WIDTH = 6
const GAPS = 6

/** Same four classes the panel paints with, mapped onto terminal tokens. */
function statusToken(status: number, matched: boolean): Token {
  if (!matched) return 'degraded'
  if (status >= 500) return 'fatal'
  if (status >= 400) return 'degraded'
  return 'recovered'
}

const padEnd = (text: string, width: number) =>
  text + ' '.repeat(Math.max(0, width - displayWidth(text)))

const padStart = (text: string, width: number) =>
  ' '.repeat(Math.max(0, width - displayWidth(text))) + text

/**
 * Truncated with an ellipsis rather than wrapped: the path is the only
 * unbounded field here, and a wrapped row destroys the column alignment
 * that makes the stream scannable in the first place.
 */
function clamp(text: string, width: number): string {
  if (width <= 1) return ''
  return displayWidth(text) <= width ? text : `${text.slice(0, width - 1)}…`
}

/**
 * One request, one line. Same fields in the same order as the panel's log
 * row, so the two surfaces read as one product.
 */
export function requestRow(row: RequestRow, level: Level, columns?: number): string {
  const width = usableWidth(columns)

  const fixed =
    TIME_WIDTH + METHOD_WIDTH + VIA_WIDTH + STATUS_WIDTH + RESOLVED_WIDTH + MS_WIDTH + GAPS
  const pathWidth = Math.max(8, width - fixed)

  const resolved = row.matched
    ? `${row.resolvedName ?? ''} · ${row.resolvedLayer ?? ''}`
    : 'no matching route'

  return [
    paint(padEnd(row.time, TIME_WIDTH), 'dim', level),
    paint(padEnd(row.method, METHOD_WIDTH), 'value', level),
    paint(padEnd(clamp(row.path, pathWidth), pathWidth), 'value', level),
    // Blank, not omitted: the column has to hold its place, or every row
    // after the first public request shifts sideways.
    paint(padEnd(row.viaPublic ? 'public' : '', VIA_WIDTH), 'accent', level),
    paint(padStart(String(row.status), STATUS_WIDTH), statusToken(row.status, row.matched), level),
    paint(padEnd(clamp(resolved, RESOLVED_WIDTH), RESOLVED_WIDTH), 'dim', level),
    paint(padStart(`${row.ms}ms`, MS_WIDTH), 'dim', level),
  ].join(' ')
}

/**
 * The line stage 1 could not print, because none of these keys were bound.
 * Indented to the start screen's value column so the two blocks align.
 */
export function keysLine(level: Level, sharing: boolean): string {
  const keys: [string, string][] = [
    ['o', 'panel'],
    ['s', sharing ? 'stop sharing' : 'share'],
    ['c', 'clear'],
    ['q', 'quit'],
  ]

  return (
    ' '.repeat(LABEL_WIDTH) +
    keys
      .map(([key, label]) => `${paint(key, 'value', level)} ${paint(label, 'dim', level)}`)
      .join(paint(' · ', 'dim', level))
  )
}
```

- [ ] **Step 4: Export from the barrel**

```ts
// packages/tui/src/index.ts — add
export * from './stream'
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bunx vitest run packages/tui`
Expected: PASS, 13 new tests plus the existing suite.

- [ ] **Step 6: Commit**

```bash
git add packages/tui/src/stream.ts packages/tui/src/stream.test.ts packages/tui/src/index.ts
git commit -m "feat(tui): render a request row and the keys line"
```

---

## Task 2: `via` on the request event

**Files:**

- Modify: `packages/core/src/events.ts` (the `request` variant)
- Modify: `packages/server/src/public-app.ts`
- Modify: `packages/server/src/public-app.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `via?: 'public'` on the `request` event. Optional and absent by default, so every existing subscriber — the panel's SSE consumer above all — keeps compiling and behaving identically.

The public listener is a **second app built from the same runtime** (ADR-0007: the tunnel sees a listener that mounts only the mocks). That makes `createPublicApp` the one place that knows a request came in over the tunnel, so it is the one place that tags it.

- [ ] **Step 1: Write the failing test**

```ts
// packages/server/src/public-app.test.ts — add to the existing suite
it('tags the requests it serves as public', async () => {
  const events: LaqiEvent[] = []
  const app = createPublicApp({
    // Reuse whatever fixture builder the neighbouring tests in this file
    // already use; do not invent a second one.
    mock: { ...mockRuntime, onRequest: (event) => events.push(event) },
    token: 'secret',
    origins: ['https://example.test'],
  })

  await app.request('/todos', { headers: { Authorization: 'Bearer secret' } })

  expect(events.find((event) => event.type === 'request')).toMatchObject({ via: 'public' })
})

it("leaves the local listener's events untagged", async () => {
  // Same runtime, the plain mock app: nothing here should learn about
  // tunnels, and a `via` on a localhost request would be a lie.
  const events: LaqiEvent[] = []
  const app = createMockApp({ ...mockRuntime, onRequest: (event) => events.push(event) })

  await app.request('/todos')

  expect(events.find((event) => event.type === 'request')).not.toHaveProperty('via')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run packages/server/src/public-app.test.ts`
Expected: FAIL — the received event has no `via` property.

- [ ] **Step 3: Add the field to the event**

```ts
// packages/core/src/events.ts — inside the `request` variant
      /**
       * Present only on a request that arrived through the tunnel. Absent
       * — not `'local'` — for everything else: the local case is the
       * overwhelming majority, and every existing subscriber predates this
       * field.
       */
      via?: 'public'
```

- [ ] **Step 4: Tag them in `createPublicApp`**

Wrap the runtime's `onRequest` before handing it to `createMockApp`:

```ts
// packages/server/src/public-app.ts — where the mock app is built
const { onRequest } = runtime.mock

const mock = createMockApp({
  ...runtime.mock,
  cors: /* keep the restricted origins this function already computes */,
  // The one place in the system that knows a request came over the tunnel.
  // Tagging at the emitter, not at the subscriber, means the panel and the
  // terminal agree without either of them knowing about cloudflared.
  onRequest:
    onRequest &&
    ((event) => onRequest(event.type === 'request' ? { ...event, via: 'public' } : event)),
})
```

Read the surrounding code and keep the existing CORS computation exactly as it is — this task changes `onRequest` and nothing else in that call. The comment at the top of `PublicRuntime` explains why the runtime, not a built app, is passed in; do not disturb that.

- [ ] **Step 5: Run test to verify it passes**

Run: `bunx vitest run packages/server packages/core`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/events.ts packages/server/src/public-app.ts packages/server/src/public-app.test.ts
git commit -m "feat(server): mark the requests that arrive through the tunnel"
```

---

## Task 3: `keys.ts` — raw mode, and getting out of it

**Files:**

- Create: `apps/cli/src/keys.ts`
- Create: `apps/cli/src/keys.test.ts`
- Move: `apps/cli/src/init/open-browser.ts` → `apps/cli/src/open-browser.ts`
- Modify: `apps/cli/src/init/run.ts` (update the import)

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces:
  - `type KeyBindings = { onPanel: () => void; onShare: () => void; onClear: () => void; onQuit: () => void }`
  - `type Stdin = Pick<NodeJS.ReadStream, 'isTTY' | 'setRawMode' | 'on' | 'off' | 'resume' | 'pause'>`
  - `function bindKeys(bindings: KeyBindings, stdin?: Stdin): { active: boolean; restore: () => void }`

`stdin` is a parameter, defaulting to `process.stdin`, purely so the tests can drive it. Every test here runs against a fake — none of them touch a real terminal, which is what makes them runnable in CI.

- [ ] **Step 1: Write the failing test**

```ts
// apps/cli/src/keys.test.ts
import { describe, expect, it, vi } from 'vitest'
import { bindKeys } from './keys'

const CTRL_C = '\u0003'
const CTRL_D = '\u0004'

function fakeStdin(isTTY: boolean) {
  const listeners = new Set<(chunk: string) => void>()
  return {
    isTTY,
    raw: false,
    resumed: false,
    paused: false,
    setRawMode(value: boolean) {
      this.raw = value
      return this as never
    },
    on(_event: string, listener: (chunk: string) => void) {
      listeners.add(listener)
      return this as never
    },
    off(_event: string, listener: (chunk: string) => void) {
      listeners.delete(listener)
      return this as never
    },
    resume() {
      this.resumed = true
      return this as never
    },
    pause() {
      this.paused = true
      return this as never
    },
    press(key: string) {
      for (const listener of listeners) listener(key)
    },
    get listenerCount() {
      return listeners.size
    },
  }
}

const bindings = () => ({
  onPanel: vi.fn(),
  onShare: vi.fn(),
  onClear: vi.fn(),
  onQuit: vi.fn(),
})

describe('bindKeys', () => {
  it('binds each of the four keys', () => {
    const stdin = fakeStdin(true)
    const handlers = bindings()
    bindKeys(handlers, stdin)

    stdin.press('o')
    stdin.press('s')
    stdin.press('c')
    stdin.press('q')

    expect(handlers.onPanel).toHaveBeenCalledOnce()
    expect(handlers.onShare).toHaveBeenCalledOnce()
    expect(handlers.onClear).toHaveBeenCalledOnce()
    expect(handlers.onQuit).toHaveBeenCalledOnce()
  })

  it('accepts the uppercase keys too', () => {
    // Caps lock on is not a reason for the tool to stop responding.
    const stdin = fakeStdin(true)
    const handlers = bindings()
    bindKeys(handlers, stdin)
    stdin.press('Q')
    expect(handlers.onQuit).toHaveBeenCalledOnce()
  })

  it('quits on ^C, because raw mode stops the driver sending SIGINT', () => {
    // THE critical case. In raw mode byte 0x03 arrives as data and no
    // signal is raised; without this branch, ^C would do nothing at all.
    const stdin = fakeStdin(true)
    const handlers = bindings()
    bindKeys(handlers, stdin)
    stdin.press(CTRL_C)
    expect(handlers.onQuit).toHaveBeenCalledOnce()
  })

  it('quits on ^D', () => {
    const stdin = fakeStdin(true)
    const handlers = bindings()
    bindKeys(handlers, stdin)
    stdin.press(CTRL_D)
    expect(handlers.onQuit).toHaveBeenCalledOnce()
  })

  it('ignores a key nothing is bound to', () => {
    const stdin = fakeStdin(true)
    const handlers = bindings()
    bindKeys(handlers, stdin)
    stdin.press('x')
    for (const handler of Object.values(handlers)) expect(handler).not.toHaveBeenCalled()
  })

  it('enters raw mode and resumes the stream', () => {
    const stdin = fakeStdin(true)
    bindKeys(bindings(), stdin)
    expect(stdin.raw).toBe(true)
    expect(stdin.resumed).toBe(true)
  })

  it('does nothing at all without a TTY', () => {
    // Piped, under a task runner, in CI, inside an agent harness. Calling
    // setRawMode on a pipe throws, and a keys line here would be a lie.
    const stdin = fakeStdin(false)
    const result = bindKeys(bindings(), stdin)
    expect(result.active).toBe(false)
    expect(stdin.raw).toBe(false)
    expect(stdin.listenerCount).toBe(0)
  })

  it('restores the terminal completely', () => {
    const stdin = fakeStdin(true)
    const { restore } = bindKeys(bindings(), stdin)
    restore()
    expect(stdin.raw).toBe(false)
    expect(stdin.listenerCount).toBe(0)
    expect(stdin.paused).toBe(true)
  })

  it('is safe to restore twice', () => {
    // Both the q handler and the signal handler call it on the way out.
    const stdin = fakeStdin(true)
    const { restore } = bindKeys(bindings(), stdin)
    restore()
    expect(() => restore()).not.toThrow()
  })

  it('restores even when setRawMode throws on the way out', () => {
    // A terminal that has already gone away. The listener must still come
    // off, or the event loop stays alive and the process never exits.
    const stdin = fakeStdin(true)
    const { restore } = bindKeys(bindings(), stdin)
    stdin.setRawMode = () => {
      throw new Error('ENOTTY')
    }
    expect(() => restore()).not.toThrow()
    expect(stdin.listenerCount).toBe(0)
  })

  it('does not throw when the terminal refuses raw mode', () => {
    const stdin = fakeStdin(true)
    stdin.setRawMode = () => {
      throw new Error('ENOTTY')
    }
    expect(bindKeys(bindings(), stdin).active).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run apps/cli/src/keys.test.ts`
Expected: FAIL — `Failed to resolve import "./keys"`.

- [ ] **Step 3: Write the implementation**

```ts
// apps/cli/src/keys.ts

export type KeyBindings = {
  onPanel: () => void
  onShare: () => void
  onClear: () => void
  onQuit: () => void
}

/** Narrowed to what this module touches, so a test can supply a fake. */
export type Stdin = Pick<
  NodeJS.ReadStream,
  'isTTY' | 'setRawMode' | 'on' | 'off' | 'resume' | 'pause'
>

/** In raw mode these arrive as data; the driver raises no signal for them. */
const CTRL_C = '\u0003'
const CTRL_D = '\u0004'

/**
 * Raw mode, the four bindings, and — the part that matters — a `restore`
 * that always works.
 *
 * Raw mode stops the terminal driver from translating `^C` into SIGINT, so
 * it arrives here as data and this module has to quit on it. Forgetting
 * that is how a tool ends up unkillable.
 *
 * Without a TTY nothing is bound and `active` is false: the caller uses
 * that to decide whether to print the keys line, because advertising a key
 * that is not bound is worse than printing nothing.
 */
export function bindKeys(
  bindings: KeyBindings,
  stdin: Stdin = process.stdin,
): { active: boolean; restore: () => void } {
  if (!stdin.isTTY) return { active: false, restore: () => {} }

  const onData = (chunk: string): void => {
    switch (chunk) {
      case 'o':
      case 'O':
        return bindings.onPanel()
      case 's':
      case 'S':
        return bindings.onShare()
      case 'c':
      case 'C':
        return bindings.onClear()
      case 'q':
      case 'Q':
      case CTRL_C:
      case CTRL_D:
        return bindings.onQuit()
      default:
      // Every other key, including arrows and escape sequences, is ignored
      // rather than guessed at.
    }
  }

  try {
    stdin.setRawMode(true)
  } catch {
    // A terminal that reports isTTY but refuses raw mode (some CI shims,
    // some Windows consoles). Serving is unaffected; the keys are not
    // available and the caller must not claim they are.
    return { active: false, restore: () => {} }
  }

  stdin.resume()
  stdin.on('data', onData)

  let restored = false
  const restore = (): void => {
    if (restored) return
    restored = true
    try {
      stdin.setRawMode(false)
    } catch {
      // The terminal is already gone. The listener still has to come off
      // below, or the event loop stays alive and the process never exits.
    }
    stdin.off('data', onData)
    stdin.pause()
  }

  return { active: true, restore }
}
```

Call `process.stdin.setEncoding('utf8')` at the call site in `index.ts` rather than here, so the fake in the tests stays as small as it is.

- [ ] **Step 4: Move `open-browser.ts` up a level**

```bash
git mv apps/cli/src/init/open-browser.ts apps/cli/src/open-browser.ts
```

Then fix the import in `apps/cli/src/init/run.ts` (`./open-browser` → `../open-browser`). It has two callers now — `laqi init --open` and the `o` key — so it is no longer an `init` concern. Its header comment already promises it never throws; that contract is what makes it safe to hang a keypress off.

- [ ] **Step 5: Run test to verify it passes**

Run: `bunx vitest run apps/cli`
Expected: PASS, including every existing `init` test after the move.

- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/keys.ts apps/cli/src/keys.test.ts apps/cli/src/open-browser.ts apps/cli/src/init/run.ts
git commit -m "feat(cli): bind the terminal keys, and always restore the terminal"
```

---

## Task 4: Sharing that can start after boot

**Files:**

- Modify: `apps/cli/src/serve.ts`
- Modify: `apps/cli/src/serve.test.ts`

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces, on `ServeHandle`:
  - `startPublicListener(port: number): Promise<number>` — resolves to the port it bound
  - `stopPublicListener(): Promise<void>`
  - `isPublicListening(): boolean`

Today the second listener exists only if `--share` was passed at startup. `s` has to be able to open one on a process that started without it — otherwise the key works for half the sessions and does nothing for the other half, which is worse than not having it.

This task moves the second listener behind start/stop; it does **not** change what that listener serves. The ADR-0007 guarantee — the tunnel sees a listener that mounts only the mocks, with `/__laqi/*` 404ing as defence in depth — holds exactly as before, because `buildPublicApp` is untouched.

- [ ] **Step 1: Write the failing test**

```ts
// apps/cli/src/serve.test.ts — add to the existing suite
it('starts a public listener on a process that booted without --share', async () => {
  const handle = await startServer({ root, config })
  expect(handle.isPublicListening()).toBe(false)

  const port = await handle.startPublicListener(0)
  expect(handle.isPublicListening()).toBe(true)

  // The whole point of the second listener: the panel is not on it.
  const panel = await fetch(`http://127.0.0.1:${port}/__laqi/api/status`)
  expect(panel.status).toBe(404)

  await handle.close()
})

it('serves the mocks on the public listener, behind the token', async () => {
  const handle = await startServer({ root, config })
  const port = await handle.startPublicListener(0)

  const unauthorised = await fetch(`http://127.0.0.1:${port}/todos`)
  expect(unauthorised.status).toBe(401)

  await handle.close()
})

it('stops the public listener and leaves the local one serving', async () => {
  const handle = await startServer({ root, config })
  const port = await handle.startPublicListener(0)
  await handle.stopPublicListener()

  expect(handle.isPublicListening()).toBe(false)
  await expect(fetch(`http://127.0.0.1:${port}/todos`)).rejects.toThrow()

  const local = await fetch(`http://127.0.0.1:${handle.port}/todos`)
  expect(local.ok).toBe(true)

  await handle.close()
})

it('is idempotent — starting twice returns the same port', async () => {
  const handle = await startServer({ root, config })
  const first = await handle.startPublicListener(0)
  const second = await handle.startPublicListener(0)
  expect(second).toBe(first)
  await handle.close()
})

it('closes the public listener when the server closes', async () => {
  // Otherwise `q` leaves a socket bound and the next start hits EADDRINUSE.
  const handle = await startServer({ root, config })
  const port = await handle.startPublicListener(0)
  await handle.close()
  await expect(fetch(`http://127.0.0.1:${port}/todos`)).rejects.toThrow()
})
```

Match the fixture helpers (`root`, `config`) the existing tests in that file already build; do not introduce a second fixture style.

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run apps/cli/src/serve.test.ts`
Expected: FAIL — `handle.isPublicListening is not a function`.

- [ ] **Step 3: Refactor the second listener behind start/stop**

In `serve.ts`, the public app is already built by a `buildPublicApp` helper and rebuilt on every reload. Lift the _listener_ out of the startup branch:

- Keep `buildPublicApp` exactly as it is, including the rate-limit `buckets` map that must survive a reload — the comment on `PublicRuntime.buckets` explains why, and this refactor must not undo it.
- Hold the server in a `let publicServer: ReturnType<typeof serve> | undefined`.
- `startPublicListener(port)`: if `publicServer` exists, return its port unchanged. Otherwise generate the token if there is none yet, build the app, `serve()` it, store it, and return the bound port.
- `stopPublicListener()`: close it and clear the variable, leaving the token in place — re-sharing within one session should not invalidate a URL someone already pasted into a phone.
- `close()`: call `stopPublicListener()` before closing the local listener.
- Keep `handle.publicPort` working by reading it from `publicServer`, so the EADDRINUSE branch in `index.ts` (which reads `error.laqiListener` and `handle.publicPort`) is untouched.

The `--share` startup path becomes a call to `startPublicListener(share.port)` rather than a second construction site. One way to open that listener, not two.

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run apps/cli`
Expected: PASS, including every existing `--share` and tunnel test unchanged.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/serve.ts apps/cli/src/serve.test.ts
git commit -m "refactor(cli): make the public listener startable after boot"
```

---

## Task 5: Wire the stream and the keys into `laqi start`

**Files:**

- Modify: `apps/cli/src/index.ts`
- Modify: `apps/cli/src/index.test.ts`

**Interfaces:**

- Consumes: `requestRow`, `keysLine` (Task 1), the `via` field (Task 2), `bindKeys` (Task 3), `startPublicListener`/`stopPublicListener` (Task 4), `openBrowser` (moved in Task 3).
- Produces: no new exports.

- [ ] **Step 1: Write the failing test**

```ts
// apps/cli/src/index.test.ts — add to the existing suite
it('prints a row for each request that lands', async () => {
  const session = await startForTest()            // the file's existing helper
  await fetch(`http://127.0.0.1:${session.port}/todos`)
  const output = await session.stop()

  expect(output).toMatch(/GET.*\/todos.*200/)
})

it('prints the keys line when stdin is a TTY', async () => {
  const session = await startForTest({ isTTY: true })
  expect(session.output).toContain('quit')
  await session.stop()
})

it('does not print the keys line without a TTY', async () => {
  // The invariant stage 1 established: never advertise an unbound key.
  const session = await startForTest({ isTTY: false })
  expect(session.output).not.toContain('quit')
  await session.stop()
})

it('still prints request rows without a TTY', async () => {
  // Piped output is a supported, quieter mode — not a broken one.
  const session = await startForTest({ isTTY: false })
  await fetch(`http://127.0.0.1:${session.port}/todos`)
  expect(session.output).toContain('/todos')
  await session.stop()
})

it('counts requests that scrolled past a clear', async () => {
  // `c` clears the screen, not the session. A summary that reset with it
  // would make the counters worthless.
  const session = await startForTest({ isTTY: true })
  await fetch(`http://127.0.0.1:${session.port}/todos`)
  session.press('c')
  await fetch(`http://127.0.0.1:${session.port}/todos`)
  const output = await session.stop()
  expect(output).toContain('2 requests')
})

it('restores the terminal on the way out', async () => {
  const session = await startForTest({ isTTY: true })
  await session.stop()
  expect(session.stdin.raw).toBe(false)
})
```

`startForTest` is the helper this file already uses to boot the CLI in-process — read it and extend it with an `isTTY` option, a `press`, and a `stdin` handle driven by the fake from Task 3, rather than writing a third harness.

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run apps/cli/src/index.test.ts`
Expected: FAIL — no request rows are printed.

- [ ] **Step 3: Subscribe to the stream**

After `report(...)` prints the start screen and before the watcher is created:

```ts
// apps/cli/src/index.ts
const pad = (n: number) => String(n).padStart(2, '0')
const clockTime = (at: Date) =>
  `${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`

handle.subscribe((event) => {
  if (event.type !== 'request') return
  console.log(
    requestRow(
      {
        // Read here and not in @laqi/tui: the formatter stays pure, which
        // is what lets the screens be tested without a terminal or a clock.
        time: clockTime(new Date()),
        method: event.method,
        path: event.path,
        status: event.status,
        resolvedName: event.resolvedName,
        resolvedLayer: event.resolvedLayer,
        ms: event.ms,
        matched: event.endpointId !== null,
        viaPublic: event.via === 'public',
      },
      outputLevel(),
      process.stdout.columns,
    ),
  )
})
```

- [ ] **Step 4: Bind the keys**

After the `shutdown` function is defined — it is what `q` calls, so it has to exist first:

```ts
// apps/cli/src/index.ts
process.stdin.setEncoding('utf8')

const keys = bindKeys({
  onPanel: () => void openBrowser(panelUrl),
  onShare: () => void toggleSharing(),
  onClear: () => {
    // Cursor home and erase, then the header again: `clear` alone would
    // take the addresses with it, which is the thing you still need.
    process.stdout.write('\u001b[2J\u001b[H')
    console.log(startScreen(lastStartInfo, outputLevel(), process.stdout.columns))
    console.log(keysLine(outputLevel(), tunnel !== undefined))
  },
  onQuit: shutdown,
})

if (keys.active) console.log(keysLine(outputLevel(), tunnel !== undefined))
```

Two things this needs from the surrounding code:

- `lastStartInfo`: the `StartInfo` the start screen was last rendered from. `report()` builds it today and throws it away — have it store the value in a `let` in scope, so `c` reprints the _current_ counts rather than the boot-time ones (a reload changes them).
- `panelUrl`: the same string the start screen prints. Take it from the same expression; do not rebuild it.

`onClear` is only ever reached when `keys.active` is true, which is why it can print the keys line unconditionally.

`o` opens the URL, and if a laqi tab is already open the operating system's opener generally focuses it rather than opening a second — that is the OS's behaviour, not something laqi implements. Do not claim otherwise in the docs.

- [ ] **Step 5: Add `restore()` to every exit path**

`keys.restore()` must be called:

- in `shutdown`, before the goodbye prints, so the summary lands on a normal terminal;
- in the watcher's fatal-reload branch, the one that calls `process.exit(reloadExit)`.

This is the constraint with no second chance: a missed path leaves the user's shell with echo off.

- [ ] **Step 6: Write `toggleSharing`**

```ts
// apps/cli/src/index.ts
const toggleSharing = async (): Promise<void> => {
  if (tunnel) {
    await tunnel.stop().catch(() => {})
    await handle.stopPublicListener()
    tunnel = undefined
    console.log(row('sharing', paint('off', 'dim', outputLevel()), outputLevel()))
    return
  }

  const unavailable = await provider.unavailable()
  if (unavailable !== null) {
    // The same reporting path a failed --share already uses. Pressing a key
    // must not become a second, quieter way for the same failure to appear.
    reportFailure({
      severity: 'degraded',
      headline: 'the tunnel could not open',
      cause: unavailable,
      outcome: 'still serving locally · sharing is off',
    })
    return
  }

  const port = await handle.startPublicListener(share?.port ?? 0)
  try {
    tunnel = await provider.start({ port })
    console.log(row('public', paint(tunnel.url, 'accent', outputLevel()), outputLevel()))
  } catch (error) {
    // Leaving the listener bound after a failed tunnel would expose a port
    // nothing is watching.
    await handle.stopPublicListener()
    reportFailure({
      severity: 'degraded',
      headline: 'the tunnel could not open',
      cause: error instanceof Error ? error.message : String(error),
      outcome: 'still serving locally · sharing is off',
    })
  }
}
```

`tunnel` is already a `let` in this function for exactly this reason — reuse it rather than adding a second variable, so the goodbye screen's `shareWasOn` check keeps working unchanged.

- [ ] **Step 7: Run test to verify it passes**

Run: `bunx vitest run apps/cli`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/cli/src/index.ts apps/cli/src/index.test.ts
git commit -m "feat(cli): stream requests to the terminal and bind the four keys"
```

---

## Task 6: Drive it by hand, then document it

**Files:**

- Modify: `apps/site/src/content/docs/docs/panel.md` (or whichever user page covers running the server)
- Modify: `apps/documentation/src/content/docs/design/terminal-output.md`
- Modify: `apps/documentation/src/content/docs/product/roadmap.md`

Automated tests cannot tell you the terminal is left usable. This task is the one that does, and it is not optional.

- [ ] **Step 1: Run it in a real terminal**

```bash
bun run build
cd examples/todo-app && node ../../apps/cli/dist/index.mjs start
```

Confirm, in order:

1. The start screen prints, with the keys line beneath it.
2. `curl localhost:8000/todos` produces one aligned row; `curl localhost:8000/nope` produces a `no matching route` row that stands out from the others.
3. A very long path truncates and does not wrap. Narrow the window to ~60 columns and check again.
4. `o` opens the panel.
5. `c` clears and reprints the header and the keys line, and nothing else.
6. `s` opens a tunnel and prints the URL; a request through that URL is marked `public`; `s` again closes it, and the keys line's label goes back to `share`.
7. `q` prints the summary, with counts that include everything from before the `c`.
8. **After exit, type into the shell. Characters echo.** This is the check the whole plan hangs on.
9. Repeat 7–8 with `^C` instead of `q`.
10. `^C` twice during shutdown exits immediately with no summary.

- [ ] **Step 2: Verify the no-TTY paths**

```bash
node apps/cli/dist/index.mjs start | cat        # rows print, no keys line, no escape codes
echo | node apps/cli/dist/index.mjs start       # stdin is a pipe: starts, does not crash
```

- [ ] **Step 3: Verify the published package did not grow a dependency**

Run: `bunx vitest run apps/cli/src/package.test.ts`
Expected: PASS. If this fails, something in this plan reached for a package it should not have.

- [ ] **Step 4: Update the design doc**

`terminal-output.md` has no mockup for the stream — Task 1 designed one. Add it to **What ships** as `4 · The stream`, with the real rendered output pasted from Step 1, and move the stage-2 items out of **Sequencing**'s pending list. Under **Open questions**, resolve number 4 with what Step 1 confirmed: the summary prints on `q` as well as on `^C`. Leave **Not built** honest about the QR, which is still not built.

- [ ] **Step 5: Document the keys for users**

Add the four keys to the user-facing docs page that covers running the server, as a small table matching the design doc's. Say that they need a real terminal, and that piping output is a supported, quieter mode rather than a broken one.

- [ ] **Step 6: Update the roadmap**

Add a Shipped row for terminal output stage 2 plus the `via public` half of stage 3, and add the deferred QR to **Next** with the decision it is waiting on written out: a new published dependency versus a Reed-Solomon encoder bundled into `@laqi/tui`. The roadmap does not mention terminal stages at all today — this entry closes that gap, which is the reason this work went missing in the first place.

- [ ] **Step 7: Run the full verification**

Run: `bun run verify`
Expected: PASS.

- [ ] **Step 8: Commit and open the PR**

```bash
git add apps/documentation apps/site
git commit -m "docs: document the request stream and the terminal keys"
git push -u origin feat/terminal-request-stream
gh pr create --title "feat(cli): stream requests to the terminal, and bind o/s/c/q" --body "..."
```

The PR body must state that the QR code is deferred and why, and must list the manual checks from Step 1 that were actually performed — particularly that the terminal echoes after every exit path.
