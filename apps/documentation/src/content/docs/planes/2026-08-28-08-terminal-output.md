---
title: "laqi v2 — Plan 8: Terminal output, stage 1"
---

# laqi v2 — Plan 8: Terminal output, stage 1

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace laqi's scattered terminal output with one rendering layer, and use it to draw the three screens a session actually has — start, failures, goodbye.

**Architecture:** A new private package `packages/tui` holds four pure modules that **return strings and never print**. That single rule is what makes every screen testable without capturing stdout, and it is what lets `apps/cli` keep deciding between stdout and stderr — which matters because under `laqi mcp` stdout is the protocol channel. `apps/cli` becomes the only place that calls `console.*`, and the 41 existing call sites route through the new vocabulary.

**Tech Stack:** Existing stack. No new dependencies — ANSI escapes are written by hand, which is a dozen lines and avoids pulling a colour library into a published package.

**Spec:** `apps/documentation/src/content/docs/diseno/terminal-output.md` — the plan argues from it; read both.

## Global Constraints

- **English everywhere** — code, comments, test names, commit messages (ADR-0009).
- **Conventional Commits.** `feat`/`fix` are VISIBLE in the changelog and releasable; `chore`, `docs`, `style`, `test`, `build`, `ci` are hidden.
- **Bun 1.3.4** is the package manager. The root `workspaces.catalog` is Bun-only.
- **`packages/tui` never prints.** Every function returns a string. Only `apps/cli` calls `console.*`.
- **`packages/server` keeps its zero-`node:*` rule** and does not import `packages/tui`.
- **No new runtime dependency** reaches the published package. `apps/cli/src/package.test.ts` pins that list and will fail if one does.
- **No box drawing.** A rule, a label column, and glyphs.
- Run `bunx oxfmt --write` on files you create; `bun run check:ci` must exit 0.
- The suite is **623 passing** across 42 files at the start of this plan, measured
  on this branch. Two draft PRs (#24, #25) each add tests on their own branches off
  `main`; neither is merged, so neither counts here.

## Verified before writing this plan

- **41 `console.*` calls in production code**: 32 in `apps/cli/src/index.ts`, 8 in `apps/cli/src/migrate.ts`, 1 in `packages/mcp/src/index.ts`.
- **`LoadError` already carries the evidence fields** the failure format needs: `{ file: string; line?: number; col?: number; message: string; excerpt?: string }` (`packages/core/src/loader.ts:14`).
- **Nothing counts anything.** No request counter exists anywhere.
- **The palette lives in the panel already**: `#0B0A0F` background, `#EAE7F2` text, `#00FFC2` accent, plus `#5a00bf`, `#c4007d`, `#ff0058`, `#ffb020`.
- Internal packages follow one shape: `private: true`, `exports: { ".": "./src/index.ts" }`, a `check-types` script, and a tsconfig extending `../config/tsconfig.base.json`.

## File Structure

| File                            | Responsibility                                                                       |
| ------------------------------- | ------------------------------------------------------------------------------------ |
| `packages/tui/src/palette.ts`   | Colour tokens and the three-level degradation ladder. Decides once, at import.       |
| `packages/tui/src/layout.ts`    | The rule, the label column, width clamping.                                          |
| `packages/tui/src/report.ts`    | `fatal()` / `degraded()` / `notice()` / `recovered()` — the five-part failure shape. |
| `packages/tui/src/screens.ts`   | `startScreen()` and `goodbyeScreen()`. Composition only.                             |
| `packages/tui/src/index.ts`     | Re-exports.                                                                          |
| `packages/core/src/counters.ts` | The session counters the goodbye summary reads.                                      |
| `apps/cli/src/index.ts`         | Loses its formatting; calls the new vocabulary.                                      |
| `apps/cli/src/migrate.ts`       | Same.                                                                                |

---

### Task 1: The palette and its degradation ladder

**Files:**

- Create: `packages/tui/package.json`, `packages/tui/tsconfig.json`, `packages/tui/src/palette.ts`
- Test: `packages/tui/src/palette.test.ts`

**Interfaces:**

- Consumes: nothing
- Produces: `type Level = 'truecolor' | 'ansi256' | 'none'`; `detectLevel(env: Record<string, string | undefined>, isTTY: boolean): Level`; `paint(text: string, token: Token, level: Level): string`; `type Token = 'bolt' | 'label' | 'value' | 'accent' | 'fatal' | 'degraded' | 'notice' | 'recovered' | 'dim'`

- [ ] **Step 1: Scaffold the package**

Create `packages/tui/package.json`:

```json
{
  "name": "@laqi/tui",
  "version": "2.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./package.json": "./package.json"
  },
  "scripts": {
    "check-types": "tsc --noEmit -p ."
  },
  "devDependencies": {
    "@types/node": "^26.2.0"
  }
}
```

Create `packages/tui/tsconfig.json`:

```json
{
  "extends": "../config/tsconfig.base.json",
  "compilerOptions": { "types": ["node"] },
  "include": ["src/**/*"]
}
```

- [ ] **Step 2: Write the failing test**

Create `packages/tui/src/palette.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { detectLevel, paint } from './palette'

describe('detectLevel', () => {
  it('uses truecolor when the terminal advertises it', () => {
    expect(detectLevel({ COLORTERM: 'truecolor', TERM: 'xterm-256color' }, true)).toBe('truecolor')
  })

  it('falls back to 256 colours on a colour terminal that does not advertise truecolor', () => {
    expect(detectLevel({ TERM: 'xterm-256color' }, true)).toBe('ansi256')
  })

  // NO_COLOR is a cross-tool convention: any value, however empty, means off.
  it('honours NO_COLOR whatever its value', () => {
    expect(detectLevel({ NO_COLOR: '1', COLORTERM: 'truecolor' }, true)).toBe('none')
    expect(detectLevel({ NO_COLOR: '', COLORTERM: 'truecolor' }, true)).toBe('none')
  })

  it('drops colour on a dumb terminal', () => {
    expect(detectLevel({ TERM: 'dumb', COLORTERM: 'truecolor' }, true)).toBe('none')
  })

  // The case that matters most: laqi's output gets piped into CI logs and
  // captured by agents, where escape codes are noise.
  it('drops colour when stdout is not a TTY', () => {
    expect(detectLevel({ COLORTERM: 'truecolor' }, false)).toBe('none')
  })
})

describe('paint', () => {
  it('wraps text in a truecolor escape and always resets', () => {
    const out = paint('laqi', 'accent', 'truecolor')
    expect(out.startsWith('\u001b[38;2;')).toBe(true)
    expect(out.endsWith('\u001b[0m')).toBe(true)
    expect(out).toContain('laqi')
  })

  it('emits a 256-colour escape at that level', () => {
    const out = paint('laqi', 'accent', 'ansi256')
    expect(out.startsWith('\u001b[38;5;')).toBe(true)
    expect(out.endsWith('\u001b[0m')).toBe(true)
    expect(out).toContain('laqi')
  })

  // The layout has to carry the meaning on its own, which is both the
  // pipe-safety requirement and the accessibility one.
  it('returns the text untouched when there is no colour', () => {
    expect(paint('laqi', 'fatal', 'none')).toBe('laqi')
  })
})
```

- [ ] **Step 3: Run it and watch it fail**

Run: `bunx vitest run packages/tui/src/palette.test.ts`
Expected: FAIL — cannot resolve `./palette`

- [ ] **Step 4: Implement**

Create `packages/tui/src/palette.ts`:

```ts
/**
 * Colour for the terminal, taken from the panel's palette so the two surfaces
 * agree. Written by hand rather than pulled from a dependency: it is a dozen
 * lines, and `apps/cli/src/package.test.ts` pins the published dependency list.
 */

export type Level = 'truecolor' | 'ansi256' | 'none'

export type Token =
  | 'bolt'
  | 'label'
  | 'value'
  | 'accent'
  | 'fatal'
  | 'degraded'
  | 'notice'
  | 'recovered'
  | 'dim'

/** The panel's values, so both surfaces read as one product. */
const RGB: Record<Token, readonly [number, number, number]> = {
  bolt: [0x8b, 0x5c, 0xf6],
  label: [0x6b, 0x66, 0x80],
  value: [0xea, 0xe7, 0xf2],
  accent: [0x00, 0xff, 0xc2],
  fatal: [0xff, 0x00, 0x58],
  degraded: [0xff, 0x7a, 0xc8],
  notice: [0x8b, 0x5c, 0xf6],
  recovered: [0x00, 0xff, 0xc2],
  dim: [0x6b, 0x66, 0x80],
}

export function detectLevel(env: Record<string, string | undefined>, isTTY: boolean): Level {
  // Presence is the signal, not the value — an empty NO_COLOR still means off.
  if (env.NO_COLOR !== undefined) return 'none'
  if (env.TERM === 'dumb') return 'none'
  if (!isTTY) return 'none'
  if (env.COLORTERM === 'truecolor' || env.COLORTERM === '24bit') return 'truecolor'
  return 'ansi256'
}

/** The 6x6x6 cube plus the grey ramp, which is what 256-colour terminals have. */
function toAnsi256(r: number, g: number, b: number): number {
  if (r === g && g === b) {
    if (r < 8) return 16
    if (r > 248) return 231
    return Math.round(((r - 8) / 247) * 24) + 232
  }
  const q = (v: number) => Math.round((v / 255) * 5)
  return 16 + 36 * q(r) + 6 * q(g) + q(b)
}

export function paint(text: string, token: Token, level: Level): string {
  if (level === 'none') return text
  const [r, g, b] = RGB[token]
  const prefix =
    level === 'truecolor' ? `\u001b[38;2;${r};${g};${b}m` : `\u001b[38;5;${toAnsi256(r, g, b)}m`
  return `${prefix}${text}\u001b[0m`
}
```

- [ ] **Step 5: Run the tests**

Run: `bunx vitest run packages/tui/src/palette.test.ts`
Expected: PASS, 8 tests

- [ ] **Step 6: Wire the package into the workspace and commit**

```bash
bun install
bunx oxfmt --write packages/tui
bun run check:ci
bun run test
git add packages/tui
git commit -m "feat(tui): a palette that degrades to plain text

Three levels: truecolor, 256-colour, none. NO_COLOR, TERM=dumb and a
non-TTY stdout all drop to none — the last one matters most, because laqi's
output gets piped into CI logs and captured by agents where escape codes are
noise. The layout carries the meaning without colour, which is the same
mechanism the accessibility requirement needs.

Colours come from the panel so both surfaces read as one product. Written by
hand rather than added as a dependency: the published dependency list is
pinned by a test, and this is a dozen lines."
```

---

### Task 2: Layout primitives

**Files:**

- Create: `packages/tui/src/layout.ts`
- Test: `packages/tui/src/layout.test.ts`

**Interfaces:**

- Consumes: `Level`, `paint`, `Token` from Task 1
- Produces: `LABEL_WIDTH = 12`; `MIN_WIDTH = 48`; `rule(left: string, right: string, width: number, level: Level): string`; `row(label: string, value: string, level: Level): string`; `usableWidth(columns: number | undefined): number`

- [ ] **Step 1: Write the failing test**

Create `packages/tui/src/layout.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { LABEL_WIDTH, MIN_WIDTH, row, rule, usableWidth } from './layout'

describe('rule', () => {
  it('fills the space between the two ends so the line is exactly the width', () => {
    const out = rule('laqi 2.0.1', 'ready in 84ms', 60, 'none')
    expect(out).toHaveLength(60)
    expect(out.startsWith('laqi 2.0.1 ')).toBe(true)
    expect(out.endsWith(' ready in 84ms')).toBe(true)
    expect(out).toContain('─')
  })

  // Below the minimum the dashes would vanish and the two ends would collide.
  it('drops the fill rather than colliding the ends when there is no room', () => {
    const out = rule('laqi 2.0.1', 'ready in 84ms', 20, 'none')
    expect(out).toBe('laqi 2.0.1 ready in 84ms')
  })
})

describe('row', () => {
  it('pads the label so values stack flush', () => {
    expect(row('serving', 'http://127.0.0.1:8000', 'none')).toBe(
      'serving'.padEnd(LABEL_WIDTH) + 'http://127.0.0.1:8000',
    )
  })

  it('does not truncate a label longer than the column', () => {
    expect(row('averylonglabelindeed', 'x', 'none')).toBe('averylonglabelindeed x')
  })
})

describe('usableWidth', () => {
  it('uses the terminal width when it is comfortable', () => {
    expect(usableWidth(100)).toBe(100)
  })

  it('never goes below the minimum, however narrow the terminal claims to be', () => {
    expect(usableWidth(10)).toBe(MIN_WIDTH)
  })

  // Not a TTY, so process.stdout.columns is undefined.
  it('assumes 80 when the width is unknown', () => {
    expect(usableWidth(undefined)).toBe(80)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `bunx vitest run packages/tui/src/layout.test.ts`
Expected: FAIL — cannot resolve `./layout`

- [ ] **Step 3: Implement**

Create `packages/tui/src/layout.ts`:

```ts
import { paint, type Level } from './palette'

/** Wide enough for `watching` plus a space; the URLs stack flush against it. */
export const LABEL_WIDTH = 12

/** Below this the rule has no room and degrades to a plain join. */
export const MIN_WIDTH = 48

const DEFAULT_WIDTH = 80

export function usableWidth(columns: number | undefined): number {
  if (columns === undefined) return DEFAULT_WIDTH
  return Math.max(columns, MIN_WIDTH)
}

/**
 * `left ─────── right`, filling to exactly `width`. One rule carries the eye
 * from the name to the timing; no box drawing, which wraps badly and ages
 * poorly.
 */
export function rule(left: string, right: string, width: number, level: Level): string {
  const fill = width - left.length - right.length - 2
  if (fill < 1) return `${left} ${right}`
  return `${left} ${paint('─'.repeat(fill), 'dim', level)} ${right}`
}

/** A dim label in a fixed column, then a bright value. */
export function row(label: string, value: string, level: Level): string {
  const padded = label.length >= LABEL_WIDTH ? `${label} ` : label.padEnd(LABEL_WIDTH)
  return `${paint(padded, 'label', level)}${value}`
}
```

- [ ] **Step 4: Run the tests**

Run: `bunx vitest run packages/tui/src/layout.test.ts`
Expected: PASS, 5 tests

> If the `rule` length assertion fails at level `none`, check that `paint`
> returns the text untouched rather than an empty string — the dashes still
> occupy their columns without colour.

- [ ] **Step 5: Commit**

```bash
bunx oxfmt --write packages/tui
git add packages/tui/src/layout.ts packages/tui/src/layout.test.ts
git commit -m "feat(tui): the rule and the label column

A fixed label column is what makes the URLs stack flush, which is what makes
the block scannable. The rule degrades to a plain join below 48 columns
rather than colliding its two ends."
```

---

### Task 3: The failure format

**Files:**

- Create: `packages/tui/src/report.ts`
- Test: `packages/tui/src/report.test.ts`

**Interfaces:**

- Consumes: `paint`, `Level` from Task 1
- Produces:

  ```ts
  type Severity = 'fatal' | 'degraded' | 'notice' | 'recovered'
  type Evidence = { file: string; line?: number; col?: number; excerpt?: string }
  type Failure = {
    severity: Severity
    headline: string
    cause: string
    evidence?: Evidence
    remedy?: readonly string[]   // at most two, rendered under `try` / `or`
    outcome: string              // e.g. 'nothing was started · exit 3'
  }
  function renderFailure(failure: Failure, level: Level): string
  const GLYPH: Record<Severity, string>
  ```

- [ ] **Step 1: Write the failing test**

Create `packages/tui/src/report.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { GLYPH, renderFailure } from './report'

const portInUse = {
  severity: 'fatal',
  headline: 'laqi could not start',
  cause: 'Port 8000 is already in use.',
  remedy: ['laqi start --port 8001', 'kill $(lsof -ti :8000)'],
  outcome: 'nothing was started · exit 3',
} as const

describe('renderFailure', () => {
  it('renders the five parts in order', () => {
    const out = renderFailure(portInUse, 'none')
    const lines = out.split('\n').filter((l) => l.trim() !== '')

    expect(lines[0]).toBe('✗ laqi could not start')
    expect(lines[1]?.trim()).toBe('Port 8000 is already in use.')
    expect(lines[2]?.trim()).toBe('try   laqi start --port 8001')
    expect(lines[3]?.trim()).toBe('or    kill $(lsof -ti :8000)')
    expect(lines[4]?.trim()).toBe('nothing was started · exit 3')
  })

  it('gives each severity its own glyph', () => {
    expect(GLYPH.fatal).toBe('✗')
    expect(GLYPH.degraded).toBe('!')
    expect(GLYPH.notice).toBe('•')
    expect(GLYPH.recovered).toBe('↻')
  })

  it('renders file:line:col when there is evidence', () => {
    const out = renderFailure(
      { ...portInUse, evidence: { file: 'laqi/api.json', line: 14, col: 7 } },
      'none',
    )
    expect(out).toContain('laqi/api.json:14:7')
  })

  it('omits the column when only a line is known', () => {
    const out = renderFailure({ ...portInUse, evidence: { file: 'laqi/api.json', line: 14 } }, 'none')
    expect(out).toContain('laqi/api.json:14')
    expect(out).not.toContain('14:')
  })

  // A degraded failure is the one that has to read as survivable, because it is.
  it('renders a degraded failure without a remedy', () => {
    const out = renderFailure(
      {
        severity: 'degraded',
        headline: 'laqi/api.json is not valid JSON',
        cause: 'A trailing comma leaves one closing brace too many.',
        outcome: 'still serving the 6 endpoints that loaded · save the file to retry',
      },
      'none',
    )
    expect(out.split('\n')[0]).toBe('! laqi/api.json is not valid JSON')
    expect(out).not.toContain('try')
    expect(out).toContain('still serving the 6 endpoints that loaded')
  })

  it('adds no escape codes at level none', () => {
    expect(renderFailure(portInUse, 'none')).not.toContain('\u001b[')
  })

  it('colours the glyph by severity when colour is on', () => {
    expect(renderFailure(portInUse, 'truecolor')).toContain('\u001b[38;2;255;0;88m')
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `bunx vitest run packages/tui/src/report.test.ts`
Expected: FAIL — cannot resolve `./report`

- [ ] **Step 3: Implement**

Create `packages/tui/src/report.ts`:

```ts
import { paint, type Level } from './palette'

export type Severity = 'fatal' | 'degraded' | 'notice' | 'recovered'

export type Evidence = {
  file: string
  line?: number
  col?: number
  /** A short frame from the file, printed verbatim. */
  excerpt?: string
}

export type Failure = {
  severity: Severity
  /** What failed, in about six words. Never the exception class. */
  headline: string
  /** One sentence, plain words, ending in a full stop. */
  cause: string
  evidence?: Evidence
  /** At most two runnable commands. Copy-pasteable, never prose. */
  remedy?: readonly string[]
  /** Whether laqi stopped or kept serving, and the exit code. */
  outcome: string
}

export const GLYPH: Record<Severity, string> = {
  fatal: '✗',
  degraded: '!',
  notice: '•',
  recovered: '↻',
}

const INDENT = '  '

function location(evidence: Evidence): string {
  const line = evidence.line === undefined ? '' : `:${evidence.line}`
  const col = evidence.line !== undefined && evidence.col !== undefined ? `:${evidence.col}` : ''
  return `${evidence.file}${line}${col}`
}

/**
 * One shape for every failure: glyph and headline, cause, evidence, remedy,
 * outcome. A reader who has seen one has seen them all, and the outcome line
 * is what tells them whether laqi is still serving.
 */
export function renderFailure(failure: Failure, level: Level): string {
  const out: string[] = []

  out.push(`${paint(GLYPH[failure.severity], failure.severity, level)} ${failure.headline}`, '')

  if (failure.evidence !== undefined) {
    out.push(`${INDENT}${paint(location(failure.evidence), 'dim', level)}`, '')
    if (failure.evidence.excerpt !== undefined) {
      for (const line of failure.evidence.excerpt.split('\n')) out.push(`${INDENT}${line}`)
      out.push('')
    }
  }

  out.push(`${INDENT}${failure.cause}`, '')

  if (failure.remedy !== undefined && failure.remedy.length > 0) {
    const labels = ['try', 'or']
    failure.remedy.slice(0, 2).forEach((command, i) => {
      const label = (labels[i] ?? 'or').padEnd(5)
      out.push(`${INDENT}${paint(label, 'label', level)} ${paint(command, 'accent', level)}`)
    })
    out.push('')
  }

  out.push(`${INDENT}${paint(failure.outcome, 'dim', level)}`)

  return out.join('\n')
}
```

- [ ] **Step 4: Run the tests**

Run: `bunx vitest run packages/tui/src/report.test.ts`
Expected: PASS, 7 tests

- [ ] **Step 5: Commit**

```bash
bunx oxfmt --write packages/tui
git add packages/tui/src/report.ts packages/tui/src/report.test.ts
git commit -m "feat(tui): one failure format, four severities

Glyph and headline, cause, evidence, remedy, outcome — the same five parts
every time, so a reader who has seen one failure has seen them all.

The outcome line is the part that earns its place: `degraded` keeps serving
what loaded, and saying so is the difference between a state you can work in
and what currently reads like a crash."
```

---

### Task 4: The start and goodbye screens

**Files:**

- Create: `packages/tui/src/screens.ts`, `packages/tui/src/index.ts`
- Test: `packages/tui/src/screens.test.ts`

**Interfaces:**

- Consumes: `rule`, `row`, `usableWidth` from Task 2; `paint`, `Level` from Task 1
- Produces:

  ```ts
  type StartInfo = {
    version: string
    servingUrl: string
    panelUrl: string
    watching: string
    endpoints: number
    responses: number
    scenarios: number
    bootMs: number
  }
  type GoodbyeInfo = {
    upMs: number
    requests: number
    unmatched: number
    flips: number
    filesWritten: readonly string[]
  }
  function startScreen(info: StartInfo, level: Level, columns?: number): string
  function goodbyeScreen(info: GoodbyeInfo, level: Level, columns?: number): string
  function formatDuration(ms: number): string
  ```

- [ ] **Step 1: Write the failing test**

Create `packages/tui/src/screens.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { formatDuration, goodbyeScreen, startScreen } from './screens'

const start = {
  version: '2.0.1',
  servingUrl: 'http://127.0.0.1:8000',
  panelUrl: 'http://127.0.0.1:8000/__laqi',
  watching: './laqi/',
  endpoints: 7,
  responses: 19,
  scenarios: 4,
  bootMs: 84,
}

describe('formatDuration', () => {
  it('reads in the largest unit that stays honest', () => {
    expect(formatDuration(84)).toBe('84ms')
    expect(formatDuration(1_500)).toBe('1.5s')
    expect(formatDuration(41 * 60_000)).toBe('41m')
    expect(formatDuration(3 * 3_600_000)).toBe('3h 0m')
  })
})

describe('startScreen', () => {
  it('names the version and the boot time on the rule', () => {
    const out = startScreen(start, 'none', 72)
    expect(out).toContain('laqi 2.0.1')
    expect(out).toContain('ready in 84ms')
  })

  // The panel is the feature laqi is built around and today's banner omits it.
  it('shows the panel URL', () => {
    expect(startScreen(start, 'none', 72)).toContain('http://127.0.0.1:8000/__laqi')
  })

  // Today's line says only how many endpoints loaded, which does not tell you
  // whether the scenarios file was picked up at all.
  it('counts responses and scenarios, not just endpoints', () => {
    const out = startScreen(start, 'none', 72)
    expect(out).toContain('7 endpoints · 19 responses · 4 scenarios')
  })

  it('singularises a lone endpoint', () => {
    const out = startScreen({ ...start, endpoints: 1, responses: 1, scenarios: 0 }, 'none', 72)
    expect(out).toContain('1 endpoint · 1 response')
    expect(out).not.toContain('scenarios')
  })

  it('stays clean of escape codes at level none', () => {
    expect(startScreen(start, 'none', 72)).not.toContain('\u001b[')
  })
})

describe('goodbyeScreen', () => {
  const goodbye = {
    upMs: 41 * 60_000,
    requests: 218,
    unmatched: 9,
    flips: 12,
    filesWritten: ['laqi/api.json'],
  }

  it('reports the session in one block', () => {
    const out = goodbyeScreen(goodbye, 'none', 72)
    expect(out).toContain('laqi stopped')
    expect(out).toContain('up 41m')
    expect(out).toContain('218 requests · 9 unmatched')
  })

  it('carries the farewell', () => {
    expect(goodbyeScreen(goodbye, 'none', 72)).toContain('tupananchikkama — until we meet again')
  })

  it('omits the files row when nothing was written', () => {
    const out = goodbyeScreen({ ...goodbye, filesWritten: [] }, 'none', 72)
    expect(out).not.toContain('files')
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `bunx vitest run packages/tui/src/screens.test.ts`
Expected: FAIL — cannot resolve `./screens`

- [ ] **Step 3: Implement**

Create `packages/tui/src/screens.ts`:

```ts
import { LABEL_WIDTH, row, rule, usableWidth } from './layout'
import { paint, type Level } from './palette'

export type StartInfo = {
  version: string
  servingUrl: string
  panelUrl: string
  watching: string
  endpoints: number
  responses: number
  scenarios: number
  bootMs: number
}

export type GoodbyeInfo = {
  upMs: number
  requests: number
  unmatched: number
  flips: number
  filesWritten: readonly string[]
}

const BOLT = '⚡'

export function formatDuration(ms: number): string {
  if (ms < 1_000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)}s`
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`
  const hours = Math.floor(ms / 3_600_000)
  return `${hours}h ${Math.round((ms - hours * 3_600_000) / 60_000)}m`
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

export function startScreen(info: StartInfo, level: Level, columns?: number): string {
  const width = usableWidth(columns)

  const counts = [plural(info.endpoints, 'endpoint'), plural(info.responses, 'response')]
  // A zero here means the scenarios file is missing or empty, which is worth
  // noticing by its absence rather than reading as "0 scenarios".
  if (info.scenarios > 0) counts.push(plural(info.scenarios, 'scenario'))

  return [
    '',
    rule(
      `${paint(BOLT, 'bolt', level)} ${paint(`laqi`, 'value', level)} ${paint(info.version, 'dim', level)}`,
      paint(`ready in ${formatDuration(info.bootMs)}`, 'dim', level),
      width,
      level,
    ),
    '',
    row('serving', paint(info.servingUrl, 'accent', level), level),
    row('panel', paint(info.panelUrl, 'accent', level), level),
    row('watching', `${paint(info.watching, 'value', level)} ${paint(counts.join(' · '), 'dim', level)}`, level),
    '',
  ].join('\n')
}

export function goodbyeScreen(info: GoodbyeInfo, level: Level, columns?: number): string {
  const width = usableWidth(columns)

  const lines = [
    '',
    rule(
      `${paint(BOLT, 'bolt', level)} ${paint('laqi stopped', 'value', level)}`,
      paint(`up ${formatDuration(info.upMs)}`, 'dim', level),
      width,
      level,
    ),
    '',
    row(
      'served',
      `${paint(plural(info.requests, 'request'), 'value', level)} ${paint(`· ${info.unmatched} unmatched`, 'dim', level)}`,
      level,
    ),
    row('flipped', paint(plural(info.flips, 'time'), 'value', level), level),
  ]

  if (info.filesWritten.length > 0) {
    lines.push(row('files', paint(info.filesWritten.join(', '), 'value', level), level))
  }

  lines.push(
    '',
    `${' '.repeat(LABEL_WIDTH)}${paint('tupananchikkama', 'bolt', level)} ${paint('— until we meet again', 'dim', level)}`,
    '',
  )

  return lines.join('\n')
}
```

Create `packages/tui/src/index.ts`:

```ts
export * from './layout'
export * from './palette'
export * from './report'
export * from './screens'
```

- [ ] **Step 4: Run the tests**

Run: `bunx vitest run packages/tui`
Expected: PASS — all four suites

- [ ] **Step 5: Commit**

```bash
bunx oxfmt --write packages/tui
bun run check:ci
git add packages/tui
git commit -m "feat(tui): the start and goodbye screens

Start gains the two things today's banner lacks: the panel URL, which is the
feature laqi is built around, and counts of responses and scenarios — a
scenarios file that failed to load currently looks identical to one that
loaded fine.

Goodbye reports the session. \`unmatched\` is the number that catches a
typo'd path in the frontend, and nothing surfaces it today."
```

---

### Task 5: Session counters

**Files:**

- Create: `packages/core/src/counters.ts`
- Test: `packages/core/src/counters.test.ts`
- Modify: `packages/core/src/index.ts` (export it)

**Interfaces:**

- Consumes: nothing
- Produces: `class SessionCounters` with `recordRequest(matched: boolean): void`, `recordFlip(): void`, `recordWrite(file: string): void`, `snapshot(): { requests: number; unmatched: number; flips: number; filesWritten: string[] }`

> The goodbye screen reads a snapshot. Nothing counts anything today, so this
> is new state on the request path — an integer increment, but it gets a test
> rather than an assumption.

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/counters.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { SessionCounters } from './counters'

describe('SessionCounters', () => {
  it('starts at zero', () => {
    expect(new SessionCounters().snapshot()).toEqual({
      requests: 0,
      unmatched: 0,
      flips: 0,
      filesWritten: [],
    })
  })

  it('counts every request, and unmatched ones twice over', () => {
    const c = new SessionCounters()
    c.recordRequest(true)
    c.recordRequest(false)
    c.recordRequest(true)
    expect(c.snapshot()).toMatchObject({ requests: 3, unmatched: 1 })
  })

  it('counts flips', () => {
    const c = new SessionCounters()
    c.recordFlip()
    c.recordFlip()
    expect(c.snapshot().flips).toBe(2)
  })

  // The goodbye line reads "laqi/api.json written 3 times", so the file is
  // named once however often it changed.
  it('lists each written file once', () => {
    const c = new SessionCounters()
    c.recordWrite('laqi/api.json')
    c.recordWrite('laqi/api.json')
    c.recordWrite('laqi/extra.json')
    expect(c.snapshot().filesWritten).toEqual(['laqi/api.json', 'laqi/extra.json'])
  })

  it('hands out a copy, so a caller cannot mutate the counters', () => {
    const c = new SessionCounters()
    c.recordWrite('laqi/api.json')
    c.snapshot().filesWritten.push('nope')
    expect(c.snapshot().filesWritten).toEqual(['laqi/api.json'])
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `bunx vitest run packages/core/src/counters.test.ts`
Expected: FAIL — cannot resolve `./counters`

- [ ] **Step 3: Implement**

Create `packages/core/src/counters.ts`:

```ts
/**
 * What the goodbye summary reports. Nothing counted anything before this, so
 * every field here is new state on a path that runs per request — kept to
 * integer increments and a Set for that reason.
 */
export class SessionCounters {
  #requests = 0
  #unmatched = 0
  #flips = 0
  readonly #files = new Set<string>()

  recordRequest(matched: boolean): void {
    this.#requests += 1
    if (!matched) this.#unmatched += 1
  }

  recordFlip(): void {
    this.#flips += 1
  }

  recordWrite(file: string): void {
    this.#files.add(file)
  }

  snapshot(): { requests: number; unmatched: number; flips: number; filesWritten: string[] } {
    return {
      requests: this.#requests,
      unmatched: this.#unmatched,
      flips: this.#flips,
      filesWritten: [...this.#files],
    }
  }
}
```

Add to `packages/core/src/index.ts`:

```ts
export * from './counters'
```

- [ ] **Step 4: Run the tests**

Run: `bunx vitest run packages/core/src/counters.test.ts`
Expected: PASS, 5 tests

- [ ] **Step 5: Commit**

```bash
bunx oxfmt --write packages/core
git add packages/core/src/counters.ts packages/core/src/counters.test.ts packages/core/src/index.ts
git commit -m "feat(core): count what the goodbye summary reports

Nothing counted anything before this. Kept to integer increments and a Set,
because recordRequest runs on every request."
```

---

### Task 6: Route the CLI through the new vocabulary

**Files:**

- Modify: `apps/cli/src/index.ts` (32 `console.*` calls)
- Modify: `apps/cli/src/migrate.ts` (8 `console.*` calls)
- Modify: `apps/cli/package.json` (add `@laqi/tui` as a workspace devDependency)
- Modify: `apps/cli/tsdown.config.ts` (inject the version, and bundle `@laqi/tui`)
- Test: `apps/cli/src/output.test.ts`

**Interfaces:**

- Consumes: everything from Tasks 1–5
- Produces: no new exports; this is the migration

> `@laqi/tui` goes in `devDependencies` with `workspace:*`, exactly like
> `@laqi/core` and its siblings. `tsdown.config.ts` already inlines
> `/^@laqi\//`, so it lands in the bundle and adds no published dependency —
> which `apps/cli/src/package.test.ts` will confirm.

- [ ] **Step 1: Add the dependency and inject the version**

In `apps/cli/package.json`, add to `devDependencies`, keeping keys alphabetical:

```json
    "@laqi/tui": "workspace:*",
```

In `apps/cli/tsdown.config.ts` the file is ESM, so `require` is not defined.
Read the manifest through `createRequire` — the file already imports from
`node:*`, so this introduces no new import style. Add at the top:

```ts
import { createRequire } from 'node:module'

const pkg = createRequire(import.meta.url)('./package.json') as { version: string }
```

Then add to the `defineConfig` object:

```ts
  // The banner reports how fast startup was; reading package.json from disk to
  // print the version would be measuring the measurement.
  define: { __LAQI_VERSION__: JSON.stringify(pkg.version) },
```

Then `bun install`.

- [ ] **Step 2: Write the failing test**

Create `apps/cli/src/output.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { startScreen } from '@laqi/tui'
import { laqiVersion } from './output'

describe('laqiVersion', () => {
  // Works from source and from the bundle: tsdown replaces the global, and the
  // fallback reads the package.json that sits one level above either location.
  it('reports a semver-shaped version', () => {
    expect(laqiVersion()).toMatch(/^\d+\.\d+\.\d+/)
  })
})

describe('the start screen as the CLI renders it', () => {
  it('names both URLs', () => {
    const out = startScreen(
      {
        version: laqiVersion(),
        servingUrl: 'http://127.0.0.1:8000',
        panelUrl: 'http://127.0.0.1:8000/__laqi',
        watching: './laqi/',
        endpoints: 7,
        responses: 19,
        scenarios: 4,
        bootMs: 84,
      },
      'none',
      72,
    )
    expect(out).toContain('http://127.0.0.1:8000')
    expect(out).toContain('/__laqi')
  })
})
```

- [ ] **Step 3: Run it and watch it fail**

Run: `bunx vitest run apps/cli/src/output.test.ts`
Expected: FAIL — cannot resolve `./output`

- [ ] **Step 4: Add the version helper**

Create `apps/cli/src/output.ts`:

```ts
import { createRequire } from 'node:module'
import { detectLevel, type Level } from '@laqi/tui'

declare const __LAQI_VERSION__: string | undefined

/**
 * tsdown replaces `__LAQI_VERSION__` at build time. Running from source it is
 * undefined, so fall back to package.json — which sits one level above this
 * module from source and one level above the bundle in the published tarball,
 * so the same relative path works in both.
 */
export function laqiVersion(): string {
  if (typeof __LAQI_VERSION__ === 'string') return __LAQI_VERSION__
  const require = createRequire(import.meta.url)
  return (require('../package.json') as { version: string }).version
}

/** Decided once. stdout, because that is where the screens go. */
export function outputLevel(): Level {
  return detectLevel(process.env, process.stdout.isTTY === true)
}
```

- [ ] **Step 5: Run the tests**

Run: `bunx vitest run apps/cli/src/output.test.ts`
Expected: PASS, 2 tests

- [ ] **Step 6: Replace the banner**

In `apps/cli/src/index.ts`, replace the body of `report()` (currently around
line 264) so the start screen comes from `startScreen()` and each load error
goes through `renderFailure()` with severity `degraded` — laqi keeps serving
the files that parsed, and the outcome line must say so:

```ts
import { renderFailure, startScreen } from '@laqi/tui'
import { laqiVersion, outputLevel } from './output'

function report(runtime: Runtime, port: number, config: LaqiConfig, bootMs: number): void {
  const level = outputLevel()
  const where = runtime.source === 'file' ? `./${config.file}` : `./${config.dir}/`
  const base = `http://${config.host}:${port}`

  const responses = runtime.table.endpoints.reduce(
    (total, endpoint) => total + Object.keys(endpoint.responses).length,
    0,
  )

  console.log(
    startScreen(
      {
        version: laqiVersion(),
        servingUrl: base,
        panelUrl: `${base}/__laqi`,
        watching: where,
        endpoints: runtime.table.endpoints.length,
        responses,
        scenarios: Object.keys(runtime.scenarios).length,
        bootMs,
      },
      level,
      process.stdout.columns,
    ),
  )

  const loaded = runtime.table.endpoints.length
  for (const error of runtime.errors) {
    console.error(
      renderFailure(
        {
          severity: 'degraded',
          headline: `${error.file} failed to load`,
          cause: error.message,
          evidence: { file: error.file, line: error.line, col: error.col, excerpt: error.excerpt },
          outcome: `still serving the ${loaded} endpoint${loaded === 1 ? '' : 's'} that loaded · save the file to retry`,
        },
        level,
      ),
    )
  }
}
```

Pass `bootMs` from the caller by recording `const startedAt = Date.now()` at the
top of `main()` and handing `Date.now() - startedAt` to `report()`.

- [ ] **Step 7: Replace the remaining failures**

Work through every other `console.error` in `index.ts` and `migrate.ts`,
replacing each with a `renderFailure()` call. Use the exit codes from the spec:
`2` no mock folder, `3` port unavailable, `4` every file failed to parse, `5`
bad flag. The existing `EADDRINUSE` handler (around line 190) becomes:

```ts
console.error(
  renderFailure(
    {
      severity: 'fatal',
      headline: 'laqi could not start',
      cause: `Port ${busyPort} is already in use.`,
      remedy: [`laqi --port ${busyPort + 1}`, `kill $(lsof -ti :${busyPort})`],
      outcome: 'nothing was started · exit 3',
    },
    outputLevel(),
  ),
)
process.exitCode = 3
```

Leave `packages/mcp/src/index.ts`'s single `console.error` alone — it is the
MCP startup banner on stderr and is out of this plan's scope.

- [ ] **Step 8: Verify the MCP channel is still clean**

Add to `apps/cli/src/output.test.ts`:

```ts
// `readFileSync` from node:fs, not `Bun.file`: vitest runs these under the
// node environment, where the Bun global is not defined. Import it at the
// top of the file.
describe('the MCP protocol channel', () => {
  // stdout carries the MCP protocol. A screen printed there corrupts it, and
  // the failure mode is a client that silently disconnects.
  it('keeps every screen off stdout in mcp mode', () => {
    const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')
    const mcpBlock = source.slice(source.indexOf("positionals[0] === 'mcp'"))
    const untilReturn = mcpBlock.slice(0, mcpBlock.indexOf('return'))
    expect(untilReturn).not.toContain('console.log')
  })
})
```

Run: `bunx vitest run apps/cli/src/output.test.ts`
Expected: PASS, 3 tests

- [ ] **Step 9: See it for real**

```bash
bun run build
cd examples/todo-app && bun run mock --port 8000
```

Expected: the new start screen with both URLs and three counts. Then in another
terminal, confirm the plain path:

```bash
NO_COLOR=1 bun run mock --port 8001 | cat
```

Expected: identical layout, zero escape codes. Report both.

- [ ] **Step 10: Full gate, then commit**

```bash
bun run check:ci && bun run build && bun run check-types && bun run check-types:scripts && bun run test
git add apps/cli packages
git commit -m "feat(cli): render every screen through @laqi/tui

The 41 console.* call sites each formatted themselves; now apps/cli composes
and the tui package renders. Load failures become \`degraded\` rather than
looking like crashes — laqi already kept serving the files that parsed, it
just never said so.

@laqi/tui is bundled by tsdown like the other workspace packages, so the
published dependency list is unchanged."
```

---

## Self-review

**Spec coverage.** Start screen → Task 4. Failure format, four severities, five parts → Task 3, applied in Task 6. Exit codes → Task 6 Step 7. Goodbye → Task 4, fed by Task 5. Colour ladder including `NO_COLOR` / `TERM=dumb` / non-TTY → Task 1. Label column and rule, no box drawing → Task 2. The 41 call sites → Task 6. stdout-is-sacred → Task 6 Step 8. Version source → Task 6 Steps 1 and 4.

**Deliberately not here.** The keys line and the request stream are stage 2; share polish is stage 3. Task 4 prints no keys line, which is why: a printed shortcut that is not bound would be a lie.

**Known risk.** Task 6 is the largest task and touches error paths with no coverage today. Step 9 exists because those paths are easier to check by running them than by reading them.
