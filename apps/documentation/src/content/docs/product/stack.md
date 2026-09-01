---
title: The stack
description: Every technology choice in the monorepo, what it does here, and why it was picked.
---

# The stack

One table per layer, each with the _why_ — because a stack list without
reasons is just a shopping receipt. Where a choice has a full ADR, it's
linked; read the ADR before proposing to change that piece.

## Runtime and language

| Tech           | Role                                                   | Why                                                                                                                     |
| -------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| **TypeScript** | Everything is TS, strict, ESM                          | v1's worst bugs were type-shaped (`res.status("200")`); non-negotiable for v2 ([ADR-0001](/decisions/0001-rewrite-v2/)) |
| **Node ≥ 20**  | The runtime users actually have                        | The published CLI must run on plain Node — Bun is never a user-facing requirement                                       |
| **Bun**        | Dev-time: install, run TS directly, workspaces catalog | Speed during development; `bun apps/cli/src/index.ts` runs the CLI from source with no build                            |

The split matters: **Bun to develop, Node to ship.** `bun run build`
produces a self-contained bundle that runs anywhere Node 20+ exists.

## The server

| Tech                  | Role                                                                      | Why                                                                                                                                                 |
| --------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Hono** (4.x)        | HTTP framework: mock serving + control plane + router (`:param` matching) | Runtime-agnostic (Node today, edge tomorrow), tiny, typed; chosen over Elysia, which is Bun-coupled ([ADR-0002](/decisions/0002-hono-over-elysia/)) |
| **@hono/node-server** | Adapter binding Hono to Node's `http`                                     | The published CLI targets Node                                                                                                                      |
| **Zod** (4.x)         | Every schema: config, endpoint, response, scenario, state                 | v1 had zero validation and it showed; every file read and API body is parsed, never trusted                                                         |
| **chokidar**          | File watching                                                             | The battle-tested option for cross-platform watching; reload-on-save is a core promise                                                              |
| **SSE** (plain)       | Live events to the panel (`/__laqi/events`)                               | One-directional server→panel needs no WebSocket machinery                                                                                           |

## The panel (`packages/editor`)

| Tech                                | Role                                    | Why                                                                                                                                                                        |
| ----------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **React 19**                        | The panel UI                            | The panel is genuinely interactive (live log, palette, editing); a plain SPA on purpose — no Astro, no TanStack Start ([ADR-0011](/decisions/0011-panel-plain-react-spa/)) |
| **Vite**                            | Build + dev server                      | Standard for a React SPA; the build output is inlined into the CLI bundle                                                                                                  |
| **@laqi/tokens**                    | Shared design tokens (CSS)              | Panel and laqi.dev share one visual language from one file                                                                                                                 |
| **JetBrains Mono / Source Serif 4** | Typography (self-hosted via Fontsource) | A dev tool reads as one: mono for anything code, no CDN dependency                                                                                                         |

The panel is `private: true` and ships **inside** the CLI bundle — one npm
tarball, not six ([ADR-0010](/decisions/0010-release-and-npm/)).

## Generation (`packages/generate`)

| Tech                          | Role                                                                               | Why                                                                                                  |
| ----------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| **quicktype-core**            | Live response body → types in ~25 languages                                        | The only serious multi-language type-derivation engine; types come from data, so they can't go stale |
| **@faker-js/faker**           | TypeScript model → realistic seeded data                                           | `email` fields get emails, `createdAt` gets dates; seeded, so regeneration is deterministic per seed |
| **typescript** (compiler API) | Parse pasted interfaces, including dirty ones (`extends`, `Pick`, missing imports) | Parsing TS with anything other than TS is a losing game                                              |
| **effect**                    | Structured pipelines/error handling in generation                                  | Generation has many partial-failure paths (skip and report, never fail the batch)                    |

## Agent integration (`packages/mcp`)

| Tech                          | Role                                  | Why                                                                                                                      |
| ----------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **@modelcontextprotocol/sdk** | MCP server over stdio, 11 typed tools | MCP is the emerging standard for agent↔tool wiring; first-class, not bolted on ([ADR-0006](/decisions/0006-mcp-server/)) |

It operates on the mock **files**, not the running server — so it works
with or without `laqi` listening.

## Sharing

| Tech            | Role                        | Why                                                                                                                                               |
| --------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **cloudflared** | Public tunnel for `--share` | No account, no login, nothing hosted by us; an external binary on PATH rather than a bundled dependency ([ADR-0007](/decisions/0007-public-url/)) |

## Monorepo and quality

| Tech               | Role                                 | Why                                                                                                              |
| ------------------ | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| **Bun workspaces** | Package linking + dependency catalog | One version of hono/zod/typescript declared once, used everywhere                                                |
| **Turborepo**      | Build orchestration + caching        | The panel must build before the CLI bundles it; turbo encodes that graph ([ADR-0005](/decisions/0005-monorepo/)) |
| **tsdown**         | Bundling the CLI                     | Rolldown-based, fast, inlines workspace deps into the self-contained binary                                      |
| **oxlint / oxfmt** | Linting and formatting               | Rust-fast, zero-config; CI runs `check:ci`                                                                       |
| **Vitest**         | Tests across all packages            | One runner for node code and React (Testing Library) alike                                                       |

## Docs, site, releases

| Tech                  | Role                                             | Why                                                                                                                    |
| --------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| **Astro + Starlight** | Both docs apps: this internal log and laqi.dev   | The default for docs sites; two separate apps so internal ADRs can never leak onto the public site                     |
| **Cloudflare Pages**  | Hosting laqi.dev                                 | Fully static build, simplest deploy from GitHub Actions                                                                |
| **release-please**    | Versioning + changelog from Conventional Commits | Merging the release PR _is_ the release; nobody publishes from a laptop ([ADR-0010](/decisions/0010-release-and-npm/)) |
| **GitHub Actions**    | CI, npm publish on tag, site deploy              | The tag from release-please triggers the publish workflow                                                              |

## What is deliberately _not_ in the stack

- **No database** — state is `.laqi/state.json`, mocks are JSON files in
  the repo. The filesystem is the database ([ADR-0003](/decisions/0003-declarative-json/),
  [ADR-0004](/decisions/0004-state-outside-git/)).
- **No cloud backend, no accounts** — everything runs on the developer's
  machine; `--share` tunnels out, it doesn't host anything.
- **No Express** — v1's foundation, abandoned with it.
- **No i18n framework** — English everywhere in the product
  ([ADR-0009](/decisions/0009-no-i18n/)); the public site adds a Spanish
  locale via Starlight's built-in i18n, which is a site concern, not a
  product one.
