---
title: ADR-0012 — Effect-first inside @laqi/generate, and nowhere else
---

# ADR-0012 — Effect-first inside `@laqi/generate`, and nowhere else

**Status:** Accepted
**Date:** 2026-09-02

## Context

`@laqi/generate` already depended on Effect, but used it as a Promise/error
adapter and nothing more: thirty call sites across four files, almost all of it
`tryPromise` to wrap a dynamic import, `fail` to raise a tagged error, and
`runPromise` to get back to a Promise at the door. No services, no layers, no
scopes, no cancellation, no observability.

An audit named this: the package was paying Effect's conceptual surface and
collecting the interest on almost none of it. It sat between two coherent
architectures — a plain core with Effect at the adapters, or a genuinely
Effect-first core — and being between them was the actual problem.

Because `laqi` publishes as one bundled package, `effect` is already installed
in every consumer's `node_modules` whether we use one API or fifty. The
decision therefore cost nothing externally and had to be made on internal
merit alone.

The analysis is in [Effect adoption](/adversarial/effect-adoption/). Its central
finding: of the five capabilities Effect offers here — services, scope, clock,
tracing, cancellation — **only cancellation forces the package boundary to
move**. The other four are reachable without any consumer knowing Effect exists.

## Decision

**`@laqi/generate` becomes Effect-first internally. Effect does not cross its
boundary.**

Each heavy dependency is a service (`TypeScriptCompiler`, `FakerFactory`,
`Quicktype`) resolved through a layer. The `*Effect` programs declare what they
need in `R` and are public API, exported alongside their tags and `*Live`
layers. The Promise facades — `parseTypes`, `generate`, `printTypes`,
`supportedLanguages` — keep their exact observable contracts and run on a
module-local runtime.

No other package migrates. `@laqi/core`, `@laqi/server`, `@laqi/mcp` and
`apps/cli` stay plain `async`/`await`.

The operational rules this implies are in
[Effect in laqi](/architecture/effect/).

## Alternatives considered

**Pull Effect back to the adapters.** Keep a plain synchronous/Promise core and
use Effect only at the server and MCP boundaries. Cheapest, and it would have
removed the conceptual surface entirely. Rejected: it discards the dependency
injection that makes the compiler and faker testable without mocking the module
loader, which was the concrete pain the audit exposed.

**Effect across the adapters (level 2).** `@laqi/mcp` and `apps/cli` each own a
`ManagedRuntime`, run programs through it, and translate typed failures at the
tool and HTTP borders. This is the only way to get real interruption. Deferred,
not rejected — level 2 contains level 1, so nothing here forecloses it. It waits
on one question: should a cancelled request actually stop the work? Until
something can be abandoned mid-flight and that costs us, the price is that every
future contributor to those two packages must read Effect to change a handler.

**Effect across the whole product (level 3).** Also convert `@laqi/core` and
`@laqi/server`. Rejected on a measured finding: `@laqi/core` contains zero
`async`, `await` or `Promise` — it is fully synchronous over synchronous `fs` —
and its `ProjectResult<T>` is a three-line hand-rolled Either that any
contributor can read. Effect over synchronous code buys the error channel and
the service graph but not the async machinery that justifies most of its weight.
It would be the largest single piece of work in the adoption and the one with
the least to show for it. Reopens only if core goes async for its own reasons.

**A `Scope` around `ts.createProgram`.** Proposed, then dropped before
implementation. Verified against TypeScript 5.9.3's type definitions: neither
`Program` nor `CompilerHost` exposes `close`, `dispose` or `release`, so it
would have been an `acquireRelease` with an empty release.

## Consequences

**Good.**

- Dependency injection where it was needed. The failure tests stopped mocking
  the Node module loader with `vi.doMock` and started providing layers, which
  made several failure cases cheap to cover that were previously not worth the
  machinery.
- Every program states its dependencies in its type. Running one without
  providing them stops type-checking, which is how the migration caught its own
  incomplete call sites.
- One load path per dependency. `supportedLanguages` had kept a second
  `import('quicktype-core')`; consolidating removed a second cache and a second
  failure shape.
- No observable change for any consumer. The Promise API, its error contracts
  and the published dependency list are all unmoved.

**What it costs.**

- A contributor to `@laqi/generate` now needs to read Effect's `Context`,
  `Layer` and `ManagedRuntime`. That was already partly true; it is now fully
  true.
- Laziness became a property that must be actively defended. The runtime
  provides three layers at once, so one eagerly-built layer would make a single
  parse load all three dependencies. This is enforced by a test, and that test
  had to be rewritten once after it was found to pass for the wrong reason.
- A module-local runtime that is never disposed is correct only while these
  layers hold nothing but lazy imports. That constraint is written into
  `services/runtime.ts` and will be violated silently if nobody reads it.

**Deferred.** Real interruption, trace spans (which need somewhere to export to
before they earn anything), and a `Clock` service — the reference date is a
constant used only for seeded generation, so injecting a clock would buy
coherence rather than behaviour.
