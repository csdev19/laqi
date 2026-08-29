---
title: ADR-0005 — Monorepo aligned with rakoi
---

# ADR-0005 — Monorepo aligned with rakoi

**Status:** Accepted
**Date:** 2026-08-24

## Context

v1 was a flat npm package of four files. v2 has at least four distinct
artifacts with distinct lifecycles: the CLI published to npm, the web
editor UI, an MCP server, a Cloudflare Worker for the relay, and a
documentation site.

## Decision

**Monorepo**, with the same tooling as `rakoi-monorepo`: Bun workspaces with
a catalog, Turborepo, oxlint + oxfmt, Vitest, tsdown for publishing, Zod 4,
Astro + Starlight for the documentation.

```
laqi/
├── apps/
│   ├── cli/            `laqi` — the binary. It's the package already on npm
│   │                   (v1.2.1); v2 is its major version, not a new package.
│   ├── documentation/  Astro + Starlight, same as rakoi
│   └── relay/          Cloudflare Worker — laqi's own public URL (phase 2)
└── packages/
    ├── core/           parser, validation, route table, state resolution
    ├── server/         the Hono app — runs the same on Node, Bun and Workers
    ├── editor/         the web UI, embedded in the CLI and served at /__laqi
    ├── mcp/            MCP server
    └── schema/         Zod + generated JSON Schema
```

## Why

**1. `core` and `server` being separate is what makes the relay possible.**

This is the main structural reason. `server` is a Hono app on top of Web
Standards that doesn't know whether it's running on Node or on a Worker.
That's what lets **the same server run on your machine and on the edge**
without duplicating code ([ADR-0007](/decisions/0007-public-url/)).

**2. The web editor is embedded, not deployed.**

`packages/editor` is a React + Vite app that compiles down to static assets
and is served by the CLI itself at `http://localhost:8000/__laqi`. No
separate app, no account, no login: `laqi` brings up the mock and its
control panel in the same process. The editor, the MCP and an HTTP control
API all talk to the same _control plane_ inside `core`.

**3. `schema` isolated because four things consume it.**

The Zod definitions are used by the CLI (validate on load), the editor
(validate forms), the MCP (describe its tools to the model) and the
published JSON Schema (autocompletion in VSCode). One single source of
truth.

**4. Aligning with rakoi lowers the context cost.**

Same package manager, same linter, same test runner, same way of
publishing. Moving between repos doesn't require recontextualizing.

## What is NOT copied from rakoi

**DDD + hexagonal architecture.** rakoi is a business app with domain rules
that justify the `domain ← application ← infra` layers. laqi is a
four-piece tool with no business domain: applying those layers here would be
ceremony without benefit.

**TDD policy from rakoi's `CLAUDE.md` is adopted, though:** no production
code without a failing test written first.

**And the MVP-first approach is adopted too:** make it work end to end
before refactoring toward the final structure.

## Alternatives considered

**Stay with a flat package.** Discarded: the relay Worker and the
documentation site can't live in the same npm package as the CLI, and
putting the editor UI in the same `package.json` as the server mixes
frontend dependencies with those of the binary installed via `npx`.

**Separate repos.** Discarded: `core` and `schema` change at the same time
as their consumers. Separate repos would force publishing and versioning on
every iteration, on a one-person project.

## Consequences

**In favour:**

- The server is written once and runs both locally and on the edge.
- The CLI published to npm doesn't drag in the editor's or the
  documentation's dependencies.
- Turborepo caches builds and tests per package.

**Against:**

- More initial ceremony than a single `package.json`.
- Care is needed so `apps/cli` bundles the already-built editor assets — if
  not, `npx laqi` breaks.
- Bun as the package manager for development, even though the published
  artifact must run on Node without Bun. Both have to be tested.
