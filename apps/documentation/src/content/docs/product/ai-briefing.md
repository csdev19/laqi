---
title: AI briefing
description: Self-contained context document for giving another AI a complete, accurate picture of laqi. Paste it whole.
---

# AI briefing

> **How to use this document:** paste it whole into another AI's context. It
> is self-contained — every fact needed to reason about laqi correctly is in
> this file, with no repo access or link-following required. Facts are
> current as of 2026-09-01, pre-release of 2.0.0.

## What laqi is

laqi is a **local mock server for frontend development**, distributed as a
single npm package (`laqi`) exposing a CLI. A developer runs it in a project
containing mock definition files; it serves fake HTTP responses so a
frontend (web, mobile, or any HTTP client) can be built against an API that
doesn't exist yet or needs to be forced into specific states (empty, slow,
erroring, unauthorized).

Its distinguishing features over hand-rolled mocks or interception
libraries (MSW, Mirage):

1. It is a **real HTTP server** — works from physical devices, other
   machines, `curl`, not just a patched browser tab.
2. **Named responses per endpoint** — each endpoint declares several
   possible responses and a mechanism decides which one is live.
3. A **web control panel** at `/__laqi` to flip responses with one click.
4. A **first-class MCP server** (`laqi mcp`) so coding agents can drive it.
5. **`laqi --share`** — a tunneled public URL to the mocks (mocks only, the
   control plane is never exposed).
6. **Type/data generation** — TypeScript model → seeded fake data, and live
   response → types in ~25 languages.

## Versioning status — critical context

- `laqi@1.2.1` on npm is an **unrelated 2022 Express-based v1** (~200 lines
  of CommonJS). `latest` still points there.
- v2 is a **full rewrite** (TypeScript, monorepo); its first release will be
  plain `2.0.0`, no beta/prerelease. Until it's published, `npx laqi`
  installs the old v1. Do not tell users to `npx laqi` as if it were v2
  until 2.0.0 is on npm.
- `laqi migrate` converts v1-format projects (`mock.config.json` /
  `mock-data/`) to v2's format.

## Mock file format

Mocks live in a **`laqi/` folder** (any number of `*.json` files, nested
folders allowed) or a single **`laqi.json`** file; the folder wins if both
exist. Each file is a JSON object with `"METHOD /path"` keys:

```json
{
  "GET /users": {
    "default": "ok",
    "responses": {
      "ok":    { "status": 200, "body": [{ "id": 1, "name": "Ada" }] },
      "empty": { "status": 200, "body": [] },
      "error": { "status": 500, "body": { "message": "boom" } }
    }
  },
  "GET /users/:id": {
    "default": "found",
    "responses": {
      "found":   { "status": 200, "body": { "id": 1, "name": "Ada" } },
      "missing": { "status": 404 }
    }
  }
}
```

- `default` names the response served when nothing overrides it.
- A response may set `status`, `body`, `delay` (ms), `headers`.
- `:param` path segments are dynamic (Hono router syntax).
- `scenarios.json` at the top of `laqi/` maps a scenario name to a set of
  `"METHOD /path"` → response-name overrides, flipping several endpoints at
  once:

```json
{
  "checkout-broken": {
    "GET /cart": "empty",
    "POST /checkout": "error"
  }
}
```

## Resolution: the one concept that decides every response

For each request, four layers are checked **in order**; the first that
applies wins:

1. **header** — request header `X-Laqi-Response: <name>` (or
   `X-Laqi-Scenario: <name>`). Persists nothing.
2. **state** — a per-endpoint override saved in `.laqi/state.json`
   (written via the panel, the API, or MCP; the file is not tracked in git).
3. **scenario** — the currently active scenario from `scenarios.json`.
4. **default** — the endpoint's own `default`. Always present, so a fresh
   project always serves something.

Every response carries `X-Laqi-Resolved: <name> (<layer>)` so the deciding
layer is always observable.

## Running it

`laqi` (default command) starts a server on `http://127.0.0.1:8000`, serves
the mocks in the current directory, watches files and reloads on change.

Flags: `--port <n>` (8000), `--host <addr>` (127.0.0.1), `--dir <path>`
(`laqi`), `--file <path>` (`laqi.json`), `--share`, `--public`,
`--share-port <n>`, `--help`. Config can also live in `laqi.config.json`
(same keys, plus `cors`, `density`, `showDescriptions`).

Subcommands: `laqi migrate [--dry-run]`, `laqi mcp`.

## Control plane API (HTTP + SSE, under `/__laqi`)

Local-only: mounted **only when the host is loopback**. With
`--host 0.0.0.0`, neither panel nor API exists. No authentication (which is
why it's loopback-gated).

```
GET    /__laqi/api/endpoints          list loaded endpoints
POST   /__laqi/api/endpoints          create one
PUT    /__laqi/api/endpoints/:id      update (:id URL-encoded, e.g. "GET /users")
DELETE /__laqi/api/endpoints/:id      delete
GET    /__laqi/api/state              active overrides + scenario
PUT    /__laqi/api/state              flip them
GET    /__laqi/api/scenarios          read scenarios.json (read-only)
GET    /__laqi/api/status             watched paths, endpoint count, load errors
GET    /__laqi/events                 SSE: request | endpoints-changed | error
```

Writes go through the same files a human would edit, and reload
immediately. The SSE stream includes requests that matched **no** route
(`endpointId: null`) — surfacing those is deliberate, since "why isn't my
mock answering" is the most common confusion.

## The web panel (`/__laqi`)

React app consuming the API above. Key behaviors: every response is a
clickable chip on its endpoint row (click = make live; clicking the default
again removes the override); rows tint by who moved them (user override vs
scenario) and name the resolving layer; a live request log sits beside the
list with unmatched requests as the loudest rows; `⌘K` command palette
(`orders boom` flips `POST /orders` to `boom`); endpoint detail edits the
definition and writes back to its source file, and offers a ready-made
`curl` with `X-Laqi-Response` set.

## MCP server

`laqi mcp` runs an MCP server over **stdio**. It operates on the mock files
in its working directory, so it works whether or not the HTTP server is
running. Eleven tools:

`list_endpoints`, `get_state`, `set_response`, `set_scenario`,
`reset_state`, `create_endpoint`, `update_endpoint`, `delete_endpoint`,
`import_openapi`, `get_types`, `generate_data`.

- `import_openapi`: OpenAPI 3.x JSON (not YAML) → mocks with example bodies
  generated from schemas; never overwrites existing endpoints unless asked;
  reports skips instead of failing the import.
- `get_types`: derive types from a live response body — TypeScript, Zod,
  Effect Schema, Python, Go, Rust, Swift, Kotlin, Dart and ~20 more
  (quicktype under the hood).
- `generate_data`: paste a TypeScript interface (dirty real-world ones are
  fine — `extends`, `Pick`, unresolvable imports) → realistic seeded data
  (`email` fields get emails, `createdAt` gets dates, ids sequential).
  Generated data lands in ordinary mock JSON; models are never stored.

Agent guidance: **prefer an MCP tool call over hand-writing a mock file.**

## Sharing (`laqi --share`)

Opens a public URL via `cloudflared` (must be on PATH; no account needed).
Security model:

- Only the **mocks** go through the tunnel. The panel + control plane live
  on a **second, local-only listener** — every `/__laqi` path answers 404
  through the public URL. A leaked mock URL can never rewrite mock files.
- A **bearer token** is required on every tunneled request (`--public`
  disables it, loudly).
- **CORS is never `*`** — only origins listed in `laqi.config.json`'s
  `cors` array. `curl` and React Native send no `Origin`, so they're
  unaffected by the default (no origins allowed).
- Rate limiting per caller and overall.

## Architecture (monorepo)

Bun workspaces + Turborepo. Published artifact: **one package** (`laqi`,
from `apps/cli`); everything else is `private: true` and inlined at build.

| Package              | Role                                                          |
| -------------------- | ------------------------------------------------------------- |
| `packages/schema`    | Zod schemas: config, endpoint, response, scenarios, state     |
| `packages/core`      | Load mocks from disk, route table, resolution, state store    |
| `packages/server`    | Hono app that serves mock responses + control plane           |
| `packages/editor`    | The web panel (React + Vite), bundled in, served at `/__laqi` |
| `packages/generate`  | Type derivation (quicktype) + seeded fake data (faker)        |
| `packages/mcp`       | MCP server (`@modelcontextprotocol/sdk`)                      |
| `packages/tokens`    | Shared design tokens (`tokens.css`), used by editor and site  |
| `packages/tui`       | Terminal output for the CLI                                   |
| `packages/config`    | Shared `tsconfig` base                                        |
| `apps/cli`           | The `laqi` binary: serve, watch, migrate, mcp                 |
| `apps/documentation` | Internal decision log (Astro + Starlight) — never deployed    |
| `apps/site`          | laqi.dev — public landing + user docs (Astro + Starlight)     |
| `examples/todo-app`  | TanStack Start frontend built against laqi                    |

The built CLI is self-contained and runs on **plain Node 20+** — Bun is a
dev-time tool only.

## Invariants an AI working on/with laqi must respect

- Everything published (code, commits, PRs, docs, UI strings) is in
  **English**; no i18n in the product surfaces.
- The panel and control plane must **never** be reachable on a non-loopback
  host or through the share tunnel.
- Endpoint writes always go **through the files** — state that isn't in
  `laqi/` files or `.laqi/state.json` doesn't exist.
- `.laqi/state.json` (active overrides) is intentionally **not tracked in
  git** — it's per-developer, per-moment.
- One npm tarball ships. Don't propose publishing internal packages.
- Releases are automated (release-please + GitHub Actions, Conventional
  Commits); nobody publishes from a laptop. Merging the release PR **is**
  the act of releasing.
