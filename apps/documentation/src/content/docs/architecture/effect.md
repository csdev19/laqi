---
title: Effect in laqi
---

# Effect in laqi

Effect is used in exactly one package: `@laqi/generate`. Everything else —
`@laqi/core`, `@laqi/server`, `@laqi/mcp`, `apps/cli` — is plain
`async`/`await` and `try`/`catch`, and a contributor can work in those without
knowing Effect exists.

That boundary is deliberate, and the reasoning is in
[ADR-0012](/decisions/0012-effect-first-in-generate/). This page is the
operational half: the pattern, the invariants, and how it got here.

## The service pattern

Each heavy dependency is a service, not a bare `import()` inside a program.

| Service              | Consumers                              |
| -------------------- | -------------------------------------- |
| `TypeScriptCompiler` | `parse-types.ts`                       |
| `FakerFactory`       | `generate.ts`                          |
| `Quicktype`          | `print-types.ts`, `supportedLanguages` |

The service value is **an effect that yields the dependency**, not the
dependency itself:

```ts
export class TypeScriptCompiler extends Context.Tag('@laqi/generate/TypeScriptCompiler')<
  TypeScriptCompiler,
  Effect.Effect<TypeScript, DependencyLoadError>
>() {}

export const TypeScriptCompilerLive = Layer.effect(
  TypeScriptCompiler,
  Effect.cached(
    Effect.tryPromise({
      try: () => import('typescript').then((m) => m.default),
      catch: (cause) => new DependencyLoadError({ dependency: 'typescript', message: reason(cause) }),
    }),
  ),
)
```

That indirection is doing three jobs at once, and each is one of the invariants
below: the load stays lazy, the layer cannot fail on construction, and the
program maps the load failure to its own domain error at the point of use.

## The four invariants

### 1. Heavy dependencies load lazily

`typescript` is 23 MB. Starting a mock server must never pay for a compiler
that may go unused. Building a layer only prepares the loader; nothing is
imported until a program actually asks.

The runtime provides all three layers at once, which creates a sharp edge: one
eager layer would make a single parse drag in faker and quicktype too.
`lazy-deps.test.ts` asserts per entry point — parsing loads only the compiler,
generating only faker, printing and language-listing only quicktype.

Explicitly **not** covered: an eagerly built `ManagedRuntime`. That is harmless
on its own, because `ManagedRuntime.make` does not build its layers until
something runs. The test asserts the property that matters — was the module
evaluated? — rather than the mechanism currently delivering it.

### 2. Layers never fail on construction

Because the service value is an effect rather than the module, the layer's own
error channel is empty. A runtime built from these layers cannot fail while
being built; a load failure surfaces where the dependency is used.

### 3. Domain error channels stay narrow

Each program maps `DependencyLoadError` to its own error at the point of use,
so the published signatures stay exactly as narrow as they were:

```ts
parseTypesEffect : Effect<A, ParseError,    TypeScriptCompiler>
generateEffect   : Effect<unknown, GenerateError, FakerFactory>
printTypesEffect : Effect<A, PrintError,    Quicktype>
```

This is what let the whole migration happen without moving a single observable
Promise contract.

### 4. Runtime ownership is explicit

The Promise facades run on a module-local `ManagedRuntime`, created on first use
and never disposed. That is defensible **only** because these layers hold lazy
imports and nothing else — no file handles, no workers, no telemetry exporter,
nothing with a finalizer worth running.

The moment a layer acquires a real resource, this stops being the right owner
and the process owner (`apps/cli`, or the MCP server) must create and dispose a
`ManagedRuntime` instead. `services/runtime.ts` carries that note in the code.

## Public surface

The `*Effect` programs are public API — they are what a future level 2 would
consume — so the barrel exports the tags, the `*Live` layers and
`GenerateServicesLive` alongside them. Publishing a program whose `R` cannot be
satisfied from outside the package is not a coherent surface.

`generateRuntime` is deliberately not exported: it is the runtime the package's
own facades use, and a consumer building Effect programs should own its own.
`public-api.test.ts` imports only through the barrel and holds that contract.

## How it got here

The record, because the corrections along the way are more useful than the
destination.

### 1. The audit

An audit of `@laqi/generate` returned five findings. Four were defects, fixed in
[#46](https://github.com/csdev19/laqi/pull/46):

- `parseTypes` accepted syntactically broken TypeScript. The compiler recovers
  an AST from a truncated interface, so `export interface User { name: string`
  returned a shape and generated mocks from whatever recovery salvaged.
  Syntactic diagnostics are now rejected before any declaration is inspected.
- `parseTypesEffect` declared `ParseError` but did not honour it. The compiler
  import used `Effect.promise`, and the checker walk after it is synchronous, so
  a failure escaped as a defect — invisible to `catchTag`, surfacing as a raw
  `FiberFailure`.
- Neither `parseTypes` nor `inferShape` had a work budget. Depth ceilings bound
  nesting but not size. Added `MAX_SOURCE_LENGTH` and `MAX_INFERRED_VALUES`.
- `Shape` bought nothing at runtime. `validateShape` now runs at the generation
  boundary.

The fifth was not a defect: Effect was being used as a Promise/error adapter,
and the package sat between two coherent architectures.

### 2. The adversarial analysis

That finding had nowhere to live — writing it as an ADR would have implied a
decision nobody had made — so the [adversarial](/adversarial/) section was
opened for it. [Effect adoption](/adversarial/effect-adoption/) worked out three
nested levels of reach and established the fact that shaped everything after:
**of Effect's five capabilities here, only interruption forces the package
boundary to move.**

It also answered the constraint that actually gated the decision — nothing
reaches a project that installs the CLI, at any level — and measured, rather
than assumed, that bundling Effect into the binary would trade 630 KB → 1.61 MB
published against 33 MB in every consumer's `node_modules`.

### 3. The handoff review

A review of the implementation plan corrected two things before any code was
written, and both held up under verification:

- **The proposed `Scope` around `ts.createProgram` was ceremonial.** Verified
  against TypeScript 5.9.3's type definitions: neither `Program` nor
  `CompilerHost` exposes `close`, `dispose` or `release`. It would have been an
  `acquireRelease` with an empty release. Dropped.
- **The caching claim was overstated.** `Program` and `CompilerHost` depend on
  one parse's source and options, so they stay per-call. `Effect.cached`
  memoises the _module_, and that is the only caching claim the code makes.

The lazy-loading guard was written first, before any service extraction, and
verified by breaking it deliberately.

### 4. The implementation review

Three more findings after the services landed, one worse than reported:

- **The exported Effect types were impossible to satisfy.** The barrel published
  `parseTypesEffect` and friends but no tags and no layers. Fixed by exporting
  the service barrel.
- **`supportedLanguages()` kept its own `import('quicktype-core')`** — two load
  paths, two caches and two failure shapes for one dependency, with a test
  double covering only one. Now `supportedLanguagesEffect`, on the service.
- **The lazy guard was order-dependent.** Adding the missing print coverage
  surfaced it: a hoisted `vi.mock` factory runs _once per file_, and
  `vi.resetModules()` does not re-run it. Only the first assertion touching a
  given module observed anything real; every later one read a cleared recording
  and asserted nothing. Rewritten with per-run `vi.doMock`, then re-verified by
  making a layer eager and confirming the parse _and_ generate tests both fail —
  where before only whichever ran first would have.

The last one is the reason this page exists. A guard that passes for the wrong
reason is worse than no guard, and the only thing that catches it is deliberately
breaking what it claims to protect.

## What is not done

Real interruption — killing in-flight compiler work when an HTTP client
disconnects or an MCP stdio pipe closes — requires the caller to hold the fiber,
which a Promise facade cannot give. That is level 2, and it needs `apps/cli` and
`@laqi/mcp` to own a runtime and bridge abort signals to fibers.

Nothing here forecloses it: level 2 contains level 1. It turns on one open
question, stated at the end of the
[adversarial analysis](/adversarial/effect-adoption/): should a cancelled
request actually stop the work?

`@laqi/core` stays out regardless. It is fully synchronous — zero `async`,
`await` or `Promise`, over synchronous `fs` — and `ProjectResult<T>` is already
a small, readable version of the error channel. Effect over synchronous code
buys the service graph but not the async machinery that justifies most of its
weight.
