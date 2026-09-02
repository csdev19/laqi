---
title: Effect adoption — how far it should reach
---

# Effect adoption — how far it should reach

**Status:** resolved for `@laqi/generate` — see [ADR-0012](/decisions/0012-effect-first-in-generate/) and [Effect in laqi](/architecture/effect/); ledger open for the rest
**Date:** 2026-09-02
**Trigger:** finding 5 of the `@laqi/generate` audit

## The question

An audit of `@laqi/generate` found that Effect was being used as a Promise/error
adapter and nothing more — paying the conceptual surface without collecting
services, scopes, observability or cancellation. Four of the five findings were
defects and shipped in PR #46. The fifth is not a defect: it is a choice between
two coherent architectures, and the project is currently sitting between them.

The direction chosen is Effect as a first-class citizen. This document is the
adversarial case that direction has to survive: what it costs, how far it spreads,
and — the hard constraint — whether any of it reaches a project that installs the
CLI.

## What is actually there today

Effect appears in four of the nine source files in `@laqi/generate` and nowhere else
in the monorepo. Thirty call sites, eleven distinct APIs, almost all of it error
plumbing.

| API                 | Uses | What it is doing                                                  |
| ------------------- | ---- | ----------------------------------------------------------------- |
| `Effect.fail`       | 8    | Raising a tagged domain error                                     |
| `Effect.tryPromise` | 4    | Wrapping a dynamic `import()`                                     |
| `Effect.gen`        | 3    | Sequencing the three public programs                              |
| `Effect.runPromise` | 3    | Exiting Effect at the Promise facade                              |
| `Data.TaggedError`  | 3    | `ParseError`, `GenerateError`, `PrintError`                       |
| `Effect.try`        | 2    | Catching a throw from synchronous recursion                       |
| 5 more              | 7    | `succeed`, `map`, `catchTag`, `catchAllDefect`, the `Effect` type |

The public surface is doubled. `parseTypes` / `generate` / `printTypes` return
Promises; `parseTypesEffect` / `generateEffect` return Effects. Both consumers —
`@laqi/mcp` and `apps/cli` — use the Promise half and translate failures into their
own result shapes with `try/catch`. Nothing outside the package has ever held an
`Effect` value.

## What Effect-first would actually buy

These five capabilities have very different price tags, and only one of them forces
the package boundary to move.

### Services and layers — real

A `Context.Tag` and `Layer` for the TypeScript compiler and for faker; the
dynamic-import dance moves inside the layer. The compiler becomes injectable, which
means the checker-failure tests added in PR #46 stop mocking the module system with
`vi.doMock` and start swapping a service. This is the capability with the clearest
payoff.

### Scope — modest

`acquireRelease` around `ts.createProgram`, so the program and its compiler host are
released on the way out, including on interruption. Today the program is
garbage-collected and no leak has been observed. It becomes worth something the
moment a request can be interrupted mid-parse — which is to say, it depends on the
capability below.

### Clock — nothing yet

Replacing the fixed `REF_DATE` constant with the `Clock` service. Reproducibility
already works, because the reference date is a constant and a seeded run is
byte-identical. This one buys coherence, not capability.

### Trace spans — conditional

`withSpan` at each arrow, a tracer layer at the process root, and somewhere to export
to. Spans nobody reads are decoration. This needs a decision about where traces go
before it earns anything.

### Timeouts and cancellation — split

Timeouts are internal and land at level 1. **Interruption does not.** A Promise
facade cannot be interrupted from outside: `runPromise` hands back a Promise, and the
fiber underneath keeps running whether or not anybody is still waiting. Interruption
requires the caller to hold the fiber.

> **The hinge.** Four of the five capabilities are reachable without any consumer
> knowing Effect exists. Only interruption — killing in-flight compiler work when the
> HTTP request aborts or the stdio pipe closes — needs the caller to own the fiber.
> The whole decision reduces to one question: **should a cancelled request actually
> stop the work?**

## Three levels of reach

These nest; each level contains the one before it.

### Level 1 — Effect-first inside the library

`@laqi/generate` becomes services, layers and scopes internally and keeps exporting
the same Promise facades. Four files change. The published API does not.

- **Touches:** `@laqi/generate`
- **Buys:** services, scope, internal timeouts, spans wired but inert
- **Does not buy:** interruption on request abort, end-to-end traces

### Level 2 — Effect crosses into the adapters

Effects become the primary API. `@laqi/mcp` and `apps/cli` each build a
`ManagedRuntime` once at startup, run programs through it, and translate typed
failures at the tool / HTTP border.

- **Touches:** `@laqi/generate`, `@laqi/mcp`, `apps/cli`
- **Buys:** real interruption when the request aborts or the pipe closes; one trace
  per request
- **Costs:** both adapters become Effect code; the `ProjectResult` border needs an
  explicit policy

### Level 3 — one error model for the whole product

`@laqi/core`'s hand-rolled `ProjectResult<T>` becomes Effect's own error channel,
file locking and atomic writes get real scopes, and `@laqi/server`'s Hono handlers
run through the runtime.

- **Touches:** the above plus `@laqi/core` and `@laqi/server`
- **Buys:** coherence — one error model everywhere
- **Costs:** the largest rewrite of the three, over the two packages that hold the
  actual product logic and the deepest test surface

Untouched at every level: `@laqi/schema`, `@laqi/editor`, `@laqi/tokens`,
`@laqi/tui`, `@laqi/config`.

## What propagates is the runtime, not the import

The instinct is that going Effect-first spreads `import { Effect } from 'effect'`
outward. It does not — that part is trivial. What spreads is the third type
parameter.

An Effect is `Effect<A, E, R>`, where `R` is what the program _requires_. The moment
`generateEffect` asks for a `Faker` service, its type says so, and nobody can run it
without providing that service. The obligation climbs the call stack until it reaches
whoever calls `runPromise` — and that party has to own a runtime built from all the
layers.

Concretely, at level 2:

- `apps/cli` builds one `ManagedRuntime` at startup from the compiler, faker and
  tracer layers, holds it for the process lifetime, and disposes it on shutdown. That
  runtime becomes a new thing the CLI owns.
- `@laqi/mcp` does the same, or receives the runtime from the CLI that starts it.
  Worth deciding deliberately: two runtimes in one process means two sets of service
  instances.
- The border where `@laqi/core` returns `ProjectResult<T>` needs a policy — translate
  at the edge, or pull core in too. Level 2 picks the first; level 3 is the second.

> **The cost that is easy to under-count.** Level 2's real price is not the rewrite.
> It is that every future contributor to `apps/cli` and `@laqi/mcp` needs to read
> Effect to change a tool handler. Today those two packages are plain `async/await`
> and `try/catch`, and a newcomer can work in them without learning anything new.

## What a project that installs laqi would feel

This is the hard constraint: laqi is a development dependency, and nothing about its
internals may reach the project that installs it.

**It does not, at any level.** Three independent reasons:

1. **The dependency is already paid for.** The published `laqi` package bundles every
   `@laqi/*` workspace package, the MCP SDK and the clack prompt engine — six
   packages ship as one. Real npm dependencies stay external, and `effect` is one of
   them today. A developer who runs `npm install --save-dev laqi` already has Effect
   on disk, whether we use one API or fifty.
2. **Nothing in their project imports from laqi.** It is a CLI binary, invoked as
   `npx laqi`. No types cross the boundary, no bundler configuration is involved, and
   there is no version to resolve against their own dependencies.
3. **The internals are bundled anyway.** How `@laqi/generate` is written is invisible
   past `tsdown`; only the external dependency list is observable, and this decision
   does not change it.

### Current external install footprint

Unpacked on disk, measured in this workspace's store. These are what a consumer
actually downloads.

| Dependency        | Unpacked | Why it is there                                                         |
| ----------------- | -------- | ----------------------------------------------------------------------- |
| `effect`          | 33 MB    | `@laqi/generate`'s error channel, plus `fast-check`, its own dependency |
| `typescript`      | 23 MB    | The real checker behind `parseTypes`. Pinned to exactly `5.9.3`         |
| `zod`             | 6.3 MB   | Config and MCP tool schemas                                             |
| `quicktype-core`  | 6.1 MB   | Printing types in the non-TypeScript languages                          |
| `@faker-js/faker` | 3.8 MB   | Mock data generation                                                    |
| `hono`            | 2.7 MB   | The mock server and control plane                                       |

These are unpacked-on-disk sizes in a bun store, not npm tarball download sizes.

### A measured aside, worth taking either way

Built rather than estimated. Adding `/^effect(\/|$)/` to `noExternal` in
`apps/cli/tsdown.config.ts` inlines Effect into the binary: the published bundle goes
from **630 KB to 1.61 MB**, the built output has zero remaining `effect` imports, and
the CLI still runs. The trade is **+1 MB downloaded once against 33 MB in every
consumer's `node_modules`**.

The same lever exists for `typescript` and `quicktype-core`, but both are loaded
through dynamic `import()` precisely so startup does not pay for them — bundling
those needs more thought than bundling Effect does.

This is independent of the Effect-first decision and can be taken on its own.

## Package ledger

What each package would face, and how much of it has actually been analysed.

| Package          | Effect today           | Analysis                                                                                                                                                                |
| ---------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@laqi/generate` | 30 call sites, 4 files | **Complete** — this document                                                                                                                                            |
| `@laqi/mcp`      | none                   | **Pending** — moves at level 2. Every tool handler is `async` + `try/catch`; the `reply()` / `errorMessage()` helpers are the translation layer a runtime would replace |
| `apps/cli`       | none                   | **Pending** — moves at level 2. Owns the process, so it owns the runtime and its disposal. `serve.ts` holds the control-plane callbacks that call into generate         |
| `@laqi/core`     | none                   | **Pending** — moves only at level 3. See the note below: it is fully synchronous                                                                                        |
| `@laqi/server`   | none                   | **Pending** — moves only at level 3. 265 `async`/`await` sites across the three Hono apps                                                                               |
| `@laqi/schema`   | none                   | Not affected. Zod schemas; swapping to Effect Schema is a separate and larger question                                                                                  |
| `@laqi/editor`   | none                   | Not affected — browser React SPA                                                                                                                                        |
| `@laqi/tui`      | none                   | Not affected — pure rendering functions                                                                                                                                 |
| `@laqi/tokens`   | none                   | Not affected — CSS tokens                                                                                                                                               |
| `@laqi/config`   | none                   | Not affected — shared tsconfig only                                                                                                                                     |

### The finding that complicates level 3

`@laqi/core` contains **zero** `async`, `await` or `Promise` in its source. It is
fully synchronous, on synchronous `fs`: 25 `readFileSync`, 23 `mkdirSync`, 21
`writeFileSync`, 2 `renameSync`. Its whole error surface is one hand-rolled Either:

```ts
export type ProjectResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; code: ProjectFailure }
```

That is worth weighing against level 3 rather than for it. Effect over synchronous
code buys the error channel and the service graph, but not the async machinery that
justifies most of its weight — and `ProjectResult` is a small, honest, readable
version of the error channel already. Converting core would be the largest single
piece of work in the whole adoption and the one with the least to show for it.

The counter-argument is real, though: sync `fs` in the same process as the HTTP
server is a latency problem waiting to happen, and if core ever goes async, doing it
through Effect is better than doing it through raw Promises. That is a separate
analysis and it belongs in this folder.

## Where this lands

**Level 1 is the first increment of Effect-first, not a hedge against it.** Services
for the compiler and faker, a scope around the program, real layers, timeouts, and
spans wired but inert until there is somewhere to send them. Four files, no consumer
changes, four of the five capabilities.

**Level 2 is a genuinely different commitment** and it buys exactly one thing:
in-flight work that stops when the caller goes away. That matters if a panel user can
fire a heavy `generate_data` and navigate off, or if an agent can abandon an MCP
call. It matters much less if every call finishes in milliseconds anyway.

**Level 3 stays closed for now**, on the strength of the synchronous-core finding
above, and reopens only if `@laqi/core` goes async for its own reasons.

## The open question

**Should a cancelled request actually stop the work?**

Yes means we plan for level 2, the adapters learn Effect, and `Scope` and the tracer
start earning their keep. No means level 1 is the whole project, and Effect stays
invisible outside `@laqi/generate`.

## Method

Measurements taken 2026-09-02 against commit `fdf4547` on `fix/generate-hardening`.
Call-site counts are from the package's non-test source files. The bundling numbers
come from actually building `apps/cli` with the config change and inspecting the
emitted bare imports; the spike was reverted afterwards. Dependency sizes are
unpacked-on-disk, not tarball download sizes.
