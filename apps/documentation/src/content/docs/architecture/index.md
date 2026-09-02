---
title: Architecture
---

# Architecture

How laqi is put together right now.

This section is kept up to date, like [concepts](/concepts/) and unlike
[ADRs](/decisions/), which record one decision at a point in time and are never
edited. An ADR answers _why we chose this_; these pages answer _what is true
today, and what must stay true_.

| Doc                                     | What it covers                                                                                                   |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| [Effect in laqi](/architecture/effect/) | Where Effect lives, the service pattern, the four invariants that hold it up, and the record of how it got there |

## The package graph

Nine packages and three apps. Dependencies point in one direction only — no
package imports something that imports it back.

```
                    ┌────────────┐
                    │   schema   │  Zod contracts. Depends on nothing.
                    └─────┬──────┘
                          │
                    ┌─────▼──────┐
                    │    core    │  Project logic: load, resolve, write.
                    └─────┬──────┘  Fully synchronous.
          ┌───────────────┼───────────────┐
          │               │               │
    ┌─────▼────┐    ┌─────▼────┐    ┌─────▼────┐
    │  server  │    │   mcp    │    │  editor  │
    │  (Hono)  │    │ (agents) │    │  (React) │
    └─────┬────┘    └─────┬────┘    └─────┬────┘
          │               │               │
          └───────────────┼───────────────┘
                          │
                    ┌─────▼──────┐
                    │  apps/cli  │  The composition root. The only thing
                    └────────────┘  that knows every other piece exists.

    ┌────────────┐   Consumed by mcp and cli. Depends on no workspace
    │  generate  │   package at all — which is why it could be migrated
    └────────────┘   to Effect in isolation.

    tokens · tui · config    Leaves. CSS tokens, terminal rendering,
                             shared tsconfig.
```

| Package          | Source lines | Role                                                                                                  |
| ---------------- | ------------ | ----------------------------------------------------------------------------------------------------- |
| `@laqi/schema`   | 149          | Zod contracts for mock files, config and state. The vocabulary everything else speaks                 |
| `@laqi/core`     | 1,314        | Loading, state resolution, atomic writes. Fully synchronous, `ProjectResult<T>` as its error channel  |
| `@laqi/generate` | 1,290        | Types ⇄ data: parse TypeScript, infer from JSON, generate mocks, print types. Effect-first internally |
| `@laqi/server`   | 754          | The mock server, the control plane and the public app, on Hono                                        |
| `@laqi/mcp`      | 679          | The agent-facing tool surface                                                                         |
| `@laqi/editor`   | 2,236        | The control panel — a plain React SPA                                                                 |
| `@laqi/tui`      | 341          | Terminal rendering: layout, palette, screens                                                          |
| `@laqi/tokens`   | —            | Design tokens as CSS, shared by the panel and the site                                                |
| `@laqi/config`   | —            | Shared tsconfig base                                                                                  |
| `apps/cli`       | 2,831        | The `laqi` binary. Owns the process and composes everything                                           |

## What actually ships

`laqi` is published as **one** npm package, not ten. `apps/cli/tsdown.config.ts`
folds every `@laqi/*` workspace package into the bundle, along with the MCP SDK
and the clack prompt engine.

Real npm dependencies stay external and are installed normally:
`typescript`, `effect`, `zod`, `quicktype-core`, `@faker-js/faker`, `hono`,
`@hono/node-server`, `chokidar`.

Two consequences worth holding on to:

- **Internal structure is invisible to consumers.** How a workspace package is
  written cannot reach a project that installs laqi. Only the external
  dependency list is observable.
- **laqi is a binary, not a library.** Nothing in a consumer's project imports
  from it — no types cross, no bundler configuration is involved, no version
  resolves against their own dependencies. It is invoked as `npx laqi`.

## Standing invariants

Rules that hold across packages. Breaking one is a bug, not a style choice.

**The composition root is `apps/cli`.** It is the only place that knows about
every package. Nothing below it reaches sideways: `@laqi/server` does not import
`@laqi/mcp`, and neither imports the other's internals.

**Heavy dependencies load lazily.** `typescript` (23 MB), `quicktype-core` and
`@faker-js/faker` are behind dynamic `import()`, so starting a mock server never
pays for a compiler it may not use. Enforced by
`packages/generate/src/lazy-deps.test.ts`.

**The panel and the control plane are loopback-only.** They mount only when the
server listens on a loopback address, so `--host 0.0.0.0` cannot expose them to
the local network.

**State is not tracked.** Active overrides live in `.laqi/state.json`, outside
git — see [ADR-0004](/decisions/0004-state-outside-git/).

**Errors are values at every boundary.** `@laqi/core` returns
`ProjectResult<T>`; `@laqi/generate` uses Effect's typed error channel;
`@laqi/mcp` returns `isError` rather than throwing. No layer hands a stack trace
to a user or an agent.
