---
title: Plan 6 audit
---

# Plan 6 audit — data generators

**Date:** 2026-08-27
**Scope:** `main...laqi-v2-data-generators` — the whole data-generators feature
(`packages/generate`, the three control-plane routes, the two MCP tools, the
panel changes and the packaging guard).
**Method:** four adversarial angles in parallel, each required to **reproduce**
a finding before reporting it and to discard anything it could not demonstrate.
The four most severe were then reproduced a second time, independently, by the
controller.

Every task in this plan already had its own spec-and-quality review, plus a
whole-branch review before the PR. This audit is what those could not be: a
look at the seams *between* tasks.

## Result

**11 findings, all real.** Five High, fixed in this round. Six Medium and Low
kept as the backlog below.

The security surface came out clean: the public `--share` listener does not
expose a single one of the new routes, even with a valid bearer token.

---

## The theme of this round: the seams

Three of the five High findings live in places no single task contains.

- Warnings are built by one task and rendered by another. Neither is wrong on
  its own; between them, the warnings reach the panel's API layer and are
  dropped on the floor.
- `getTypes` wraps its call in a try/catch. Its twin `generateData` does not.
  Each looks fine in isolation; the pair is inconsistent, and the inconsistent
  half returns a bare 500.
- The panel's Regenerate writes into the editor draft asynchronously, which
  quietly undoes a fix a previous audit round had made to that very draft.

Eleven task reviews did not see them, because none of them is inside a task.

And one older lesson came back. Round 2 of the v2 audit found a test that
asserted `listenerCount === 0` — pinning the very bug it shipped with. Finding
1 below is the same shape: the test asserts the broken tuple result, so the
data loss was locked in place by its own regression test.

---

## High — fixed in this round

### 1. Heterogeneous tuples lost all their data

`[string, number]` generated `[null, null, null]`. Nested too: a field
`cells: [string, boolean]` produced three nulls. Arity was lost even when the
element types agreed — `[number, number]` generated **three** numbers.

The tuple branch reduced its element shapes with `mergeShapes`, which exists to
widen the items of a *homogeneous array* and deliberately falls to `unknown` the
moment two primitives disagree. That is the opposite of what a tuple is for.

**The test pinned it.** `parse-types.test.ts` asserted the broken shape
verbatim, so the defect had a regression test defending it.

The Shape IR now has a `tuple` kind that carries each element's shape and the
tuple's length, and the test asserts the correct result while still covering
what it originally guarded.

### 2. One small request could generate a billion values

The `arrayLength` clamp of 1..1000 was applied **per nesting level**, so the
total work was `arrayLength ^ depth`. A twenty-byte model — `string[][][]` —
with `arrayLength: 100` produced **1,000,000 values, 17 MB, 1.7 s**. At the
allowed maximum that is 10^9. laqi's server is single-threaded, so the panel
and the SSE stream were blocked for the whole generation; one angle measured a
32-second stall from a 50 KB body.

Not a remote attack: the control plane's Origin guard already rejects
cross-origin writes, so a hostile page cannot trigger it. It was a way for a
developer to freeze their own panel with a plausible model.

There is now a per-request budget on generated values, and exceeding it fails
with a message naming both levers rather than silently truncating.

### 3. A late Regenerate overwrote a concurrent reload

Regenerate's `.then()` wrote into the draft with no staleness guard. If the
file watcher reloaded while the request was in flight, the reload refreshed the
draft correctly and the late response then overwrote it with pre-reload data.

This is precisely the "the detail draft reset on object identity" fix from the
v2 audit, undermined by a new asynchronous write path added next to it.

Reading the same handler turned up something worse beside it: `.catch(() => {})`
discarded the error entirely, so a Regenerate that failed was completely silent.

### 4. The panel threw every warning away

`parseTypes` produces warnings — a dropped index signature, an unresolvable
import degraded to `unknown`, a type it could not represent. They travel intact
through the CLI callback, the control-plane route and the panel's API client,
and then **no component renders them**. A user pasting a model with any of
those got degraded data and not one word of explanation.

### 5. `generateData` had no try/catch, unlike its twin

Any failure fell through to Hono's default handler and came back as a bare
`500 Internal Server Error` with no body. Two angles reached it independently:
one through a stack overflow on deeply nested JSON, the other through a real
faker defect (`literals` with no values throws "Cannot get value from empty
dataset"). A user of *create from a model* could see only "Internal Server
Error" with nothing to act on.

---

## Backlog — Medium and Low, not fixed in this round

| # | Severity | What | Where |
| --- | --- | --- | --- |
| 6 | Medium | `firstName` and `lastName` both get a **full** name (`{"firstName":"Claudine Kuhn","lastName":"Edwin Bode"}`). All five name variants map to the same `faker.person.fullName()`. A pasted `User` — the most common case there is — comes out visibly wrong. | `packages/generate/src/generate.ts`, the `person` rule |
| 7 | Medium | The walkthrough claims the generated `title` "reads like a real sentence". It is Latin lorem ipsum (`"truculenter doloribus eveniet"`). Either the copy or the rule should change. | `probar-v2.md` step 6 |
| 8 | Low | A response body of `[]` makes *Copy types* copy an **empty string**, silently, with a 200. `null` and an absent body both degrade sensibly. | `inferShape([])` → `array<unknown>`, which quicktype prints as nothing |
| 9 | Low | MCP `get_types` leaks the `(FiberFailure)` prefix into the tool error text. The equivalent HTTP route returns a clean 400. | `packages/mcp/src/server.ts` |
| 10 | Low | `arrayLength: NaN` escaped the clamp and returned an empty array. Unreachable through HTTP/MCP because zod rejects it first; broken only in the exported library contract. | fixed alongside finding 2 |
| 11 | Low | The `>= 0` assertions in the `paid`/`valid`/`void`/`rapid` test are **vacuous** — proven by reintroducing the historical bug and watching the test still pass. It documents a regression it cannot catch. | `packages/generate/src/generate.test.ts` |

Also carried over from the branch's own reviews, all still Minor: no recursion
depth guard in `inferShape` (a 10,000-deep body raises `RangeError`); the *Copy
types* button has no `.catch` at all; no keyboard or accessibility tests for the
new panel controls; lint warnings went from 13 to 15 (an `Array#sort` cluster).

---

## Checked and cleared

This section is deliberately explicit. The v2 audit's most expensive finding was
hidden inside a parenthesis in a passage exactly like this one, so what was
cleared is recorded as carefully as what was found.

- **The public listener exposes none of it.** All three new routes 404 on the
  shared-tunnel port, with and without a valid bearer token, while `/users`
  stays reachable. The control-plane app is never mounted onto the public app.
- **No prototype pollution.** Models and JSON with `__proto__`, `constructor`,
  `prototype` and `toString` fields round-trip as plain own properties; the
  result still spreads and stringifies.
- **No traversal or decode bug on `:id`.** `../../../etc/passwd`, encoded
  slashes, embedded NUL, a bare `%` and `%zz` all return clean 404 JSON.
- **MCP tools really are read-only.** A sha256 of the whole project tree is
  identical before and after eight hostile `get_types`/`generate_data` calls.
- **The seed contract holds across processes**, not just within one: the same
  seed and shape produce byte-identical output from two separate runs. Seeded
  dates pin to the fixed reference date; unseeded ones track real time.
- **Effect does not leak.** No Effect import or type anywhere outside
  `packages/generate`, and the resolver enforces it — `effect` is not hoisted,
  so a sibling package cannot even resolve it.
- **Lazy loading is real, not just guarded.** `--help` takes ~0.07 s on both
  this branch and `main`; the entry chunk carries no static import of
  typescript, quicktype-core, faker or effect.
- **No route shadowing.** Mock endpoints that collide by name with the new
  control-plane paths still serve their own bodies; every pre-existing route and
  the panel assets still work.
- **Hot reload is safe under load.** Thirty concurrent generations with distinct
  seeds plus a mid-flight file rewrite: no crashes and no cross-request
  contamination — the faker instance and the id counters are per-call.
- **Emitted types compile.** `typescript` and `typescript-zod` output typechecks
  under `tsc --strict` for a shape spanning objects, arrays, literals, records,
  dates, optionals and nesting. Python, Go, Swift, Kotlin, Rust and Dart all
  emit plausible non-empty output.
- **Types really are live.** Changing a mock body and re-requesting types picks
  up the new field immediately.
- **Dirty TypeScript works as advertised.** `extends` + `Pick` + an
  intersection + an unresolvable import parses; the unresolvable field degrades
  to `unknown` with a named warning rather than crashing or vanishing.

## The lesson

Round 1 of the v2 audit left its worst finding inside a parenthesis. Round 2
left two of its three worst in fixes that were made quickly and never reviewed.
This round's lesson is about **decomposition**: three of five High findings sit
in the seams between tasks, invisible to per-task review by construction,
because no task contains them. Splitting work into reviewable units also splits
the places a reviewer looks — and the gaps between those places are where the
defects went.

The corollary is that the whole-branch review is not a formality after the task
reviews. It is the only pass that can see a seam at all, and on this branch it
was scoped too narrowly — it verified constraints (no new write paths, Effect
containment, lazy loading) rather than hunting for interactions.
