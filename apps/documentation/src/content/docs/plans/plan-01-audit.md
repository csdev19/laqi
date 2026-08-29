---
title: Plan 1 audit
---

# Plan 1 audit

**Date:** 2026-08-24
**Method:** the plan's API assumptions were verified by **running real code**
against the exact versions the plan pins (Zod 4.3.6, Hono 4.12.3,
chokidar 4, @hono/node-server 1.19), in a sandbox with Bun 1.3. This is not a
reading review: every claim below has an experiment behind it.

**Context:** the plan will be executed by subagents running an economical
model that will copy the code verbatim. That is why the audit's standard is
"zero improvisation required": any bug in the plan would become a bug in the
product.

**Result: 3 real bugs found and fixed, 4 robustness improvements, and
everything verified was noted in the plan so the executor does not re-derive
it.** The plan is already corrected; this is the log.

---

## Bugs found (already fixed in the plan)

### 1. The `serve` test could not pass: `port: 0` vs `min(1)`

`serve.test.ts` uses `ConfigSchema.parse({ port: 0 })` to request an ephemeral
port, but `ConfigSchema` declared `port: z.number().int().min(1)`. The first
test in Task 12 would have thrown in `beforeEach`, and an economical executor
would have "fixed" either side blindly.

**Fix:** `min(0)` with a comment (`0` = OS-assigned ephemeral port), and the
range-rejection test uses `-1` instead of `0`.

### 2. `parseJsonWithPosition` depended on V8's error format

Verified by running the same broken JSON on both engines:

```
Node 22:  Expected double-quoted property name in JSON at position 22 (line 4 column 1)
Bun 1.3:  JSON Parse error: Property name must be a string literal
```

The plan extracted the position with `/at position (\d+)/`. On Bun
(JavaScriptCore) **there is no position at all**, and on modern Node the most
direct data is the `(line N column N)` suffix. Consequence: the F8 error band
would have pointed at line 1 whenever the CLI ran under Bun in development.

**Fix:** try `(line N column N)` first, then `at position N`, and document
the degradation under Bun (the CLI published via `npx` runs on Node, so
production always has a position). The tests run under Vitest (Node), so
they are deterministic.

### 3. Prototype chain: `X-Laqi-Response: toString` served garbage

Verified: `'toString' in {}` is `true`. In `resolve.ts`,
`endpoint.responses[name]` with `name = 'toString'` returns the function
inherited from `Object.prototype` — truthy — so it passed the
`if (!response)` check and the handler tried to serve it: `response.status`
undefined → runtime handler crash, triggerable by any client sending a
header.

**Fix:** `Object.hasOwn` in the lookup in `resolve.ts` and in the two
analogous spots in `migrate.ts`, plus a new test
(`rejects a prototype-chain name like "toString"`).

---

## Robustness improvements (already applied)

### 4. chokidar 4 does not watch nonexistent paths → F9 broken

Verified: with `watch([nonexistent-path])`, creating the folder afterward
**triggers no event at all** (chokidar 4 removed that capability from v3).
The plan filtered paths with `existsSync` at startup, so in a fresh project
(flow F9: zero mocks) the list stayed empty and creating `laqi/` never
triggered a reload.

**Fix:** `watchMocks` now watches **the project root, pruning** everything
that is not `laqi/` or `laqi.json` (the `ignored` function cuts descent
short, so `src/` and `node_modules` are not indexed). The pattern was
verified by running it: noise filtered out, and `laqi/` created later
detected. New signature (`{ root, dir, file, onChange }`) and a new test for
the F9 case.

### 5. Shebang on line 2

The `index.ts` block had the path comment above
`#!/usr/bin/env node`. Copied verbatim, the shebang does not work. The order
was fixed with an explicit note.

### 6. Pinning `@hono/node-server`

The plan called for `^1.13.7`; today `bun add` without a pin installs 2.x.
The plan's full pattern was verified (serve with `port: 0`, `address()`,
hot-swapping the app without releasing the socket, `close()`) against
**1.19.7**, and that version was pinned.

### 7. Minor

- `report()` said `watching ./laqi/` even in single-file mode; it now
  distinguishes by `runtime.source`.
- Noted the limitation that two duplicate keys **within the same file** get
  deduplicated by `JSON.parse` before the loader ever sees them (the last one
  wins) — inherent to JSON; ADR-0008's detection is across files. Still needs
  documenting in Plan 5.

## Verified and correct (no changes)

So the executor neither doubts it nor re-verifies it:

| Plan assumption                                                                                                                                | Result                                                |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Zod 4.3.6: `superRefine` + `ctx.addIssue({ code: 'custom', path })`                                                                            | ✔ works, message and path as the tests expect         |
| Zod 4.3.6: two-argument `z.record(k, v)`, `.default({})`, `.nullable().default(null)`                                                          | ✔                                                     |
| Hono 4.12.3: `app.on(method, path)`, `c.json(body, status)`, `c.body(null, 204)`, `app.all('*')` as 404, `hono/cors`, `hono/utils/http-status` | ✔ all of it, including the 404 for undeclared methods |
| `@hono/node-server` 1.19: `serve({fetch, port: 0})` + `address().port` + replacing the app without restarting the socket                       | ✔ hot-swap confirmed live                             |
| chokidar 4: named `import { watch }`, `ignored` as a function, dotfile pruning                                                                 | ✔                                                     |
| `bun run test -- <filter>` forwards the filter to vitest                                                                                       | ✔ (with and without `--`)                             |

## Changes derived to the plan

- New section **"Notes for the executor"** with the rules for the economical
  model: copy verbatim, do not change versions, do not weaken tests, run the
  full `bun run test` + `check-types` before every commit, and do not "fix"
  APIs by consulting external documentation (they are already verified).
- Updated test counts: resolve 13, serve+watcher 11, total ~95.
