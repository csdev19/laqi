---
title: Effect migration — implementation handoff
---

# Effect migration — implementation handoff

**Date:** 2026-09-02  
**Status:** implementation in progress in another model/session  
**Companion:** [Effect adoption](/adversarial/effect-adoption/)

## Current recommendation

Adopt Effect to **Level 1** first: make `@laqi/generate` Effect-first internally,
while preserving its Promise facades. Do not migrate `@laqi/core`, `@laqi/server`,
the editor, MCP, or the CLI as part of this work.

The package currently exposes useful `Effect<A, E>` programs, but Effect is mostly
an error/Promise adapter: consumers use `parseTypes`, `generate`, and `printTypes`,
all of which return Promises. Introducing services and layers inside `generate` is
the next useful learning step because it gives dependency injection and clean test
doubles without widening the public API.

## Proposed slices

Each slice should leave the repository green and be independently committable.

0. Add `services/`, production layers, a **lazy module-local runtime** used only by
   the existing Promise facades, and a regression test proving that importing
   `@laqi/generate` alone does not load `typescript`, `quicktype-core`, or
   `@faker-js/faker`.
1. Move `parse-types.ts` to a `TypeScriptCompiler` service. Its signature becomes
   `Effect<A, ParseError, TypeScriptCompiler>`. Tests should provide a failing test
   layer rather than mock the Node module loader with `vi.doMock`.
2. Move `generate.ts` to a `FakerFactory` service.
3. Move `print-types.ts` to a `Quicktype` service.
4. Add spans and internal timeouts only where measurements justify them.

`Clock` is intentionally deferred. The fixed reference date is used only for
seeded generation; unseeded generation already uses the real clock. A Clock service
would improve conceptual consistency, not current behaviour.

## Non-negotiable constraint: retain lazy loading

`typescript` is roughly 23 MB and `quicktype-core` is also deliberately dynamically
imported. A module-level runtime must not accidentally turn either into startup
work. The import must remain inside a lazy `Layer`/effect (for example,
`Effect.tryPromise`), never as a static top-level import. The startup test is the
first test to write, before the service extraction.

The existing `parseTypesEffect` uses `Effect.promise` for its compiler import;
the extracted layer should instead use `Effect.tryPromise` and map import failures
to `ParseError` or a specific dependency-load error. `generate.ts` and
`print-types.ts` already demonstrate the `tryPromise` pattern.

## Review notes on the proposal

The slice order is sound and L1 is compatible with a future L2: no decision about
request cancellation is forced by the internal service work.

Two caveats matter during implementation:

1. Node's module cache already memoizes the imported TypeScript module. Do not make
   `ts.Program` or a `CompilerHost` process-global merely to obtain more caching:
   both depend on a specific pasted source and compiler options. Build a program per
   parse unless profiling demonstrates a safe reusable boundary.
2. `Scope` should own an actual acquire/release lifecycle. `ts.createProgram` does
   not expose a meaningful `close()` operation, so putting it in a scope does not
   by itself release compiler memory earlier than garbage collection. Use Scope for
   a real resource (or when cancellation/resource ownership is introduced), not as
   ceremonial wrapping.

The module-local runtime also needs an explicit ownership note: it is appropriate
for L1 because its services are lazy imports with no long-lived handles. If a future
layer opens handles, starts workers, or exports telemetry, the process owner (CLI or
MCP) must create and dispose the `ManagedRuntime` instead.

## What remains outside this migration

Real interruption is a Level 2 concern. A Promise returned by `runPromise` does not
give the caller a fiber it can interrupt when an HTTP client disconnects or an MCP
stdio connection closes. That becomes relevant only when `apps/cli` and/or
`@laqi/mcp` own a runtime and bridge abort signals to fibers.

Do not migrate `@laqi/core` prematurely. It is entirely synchronous and its
`ProjectResult<T>` is already a small, explicit error channel. Its migration becomes
worth reopening if its synchronous filesystem operations become a measured server
latency problem and the package is first made asynchronous for that reason.

## Completion checks

- Importing `@laqi/generate` alone does not evaluate its three heavy dependencies.
- The existing Promise API and its observable error contracts remain unchanged.
- Effect programs expose their dependencies through `R`, and production layers
  satisfy them internally for Promise callers.
- Dependency failures and domain failures remain typed and readable at the Promise
  boundary; no raw `FiberFailure` leaks to MCP or HTTP responses.
- Test layers replace module-loader mocks for the extracted service.
