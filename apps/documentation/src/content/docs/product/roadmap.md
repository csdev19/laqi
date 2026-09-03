---
title: Roadmap
description: What has shipped, what is in flight, and what comes next — the single place to answer "what's the state of laqi".
---

# Roadmap

**Last reviewed: 2026-09-02.** Statuses here are verified against merged
PRs, not against plan documents.

## Shipped — in v2.0.0's scope, merged to `main`

| What                                                                                                                | Where it landed     |
| ------------------------------------------------------------------------------------------------------------------- | ------------------- |
| Core mock server: `laqi/` folder or `laqi.json`, validation, hot reload, the four resolution layers, `laqi migrate` | Plan 1, PR #1       |
| Control plane: `/__laqi/api/*` CRUD + state + scenarios + live SSE stream                                           | Plan 2a, PR #3      |
| Web panel at `/__laqi`: one-click flips, live request log, `⌘K`, endpoint editing                                   | Plan 2b, PR #4      |
| MCP server over stdio — eleven tools, including `import_openapi`                                                    | Plan 3, PR #5       |
| `laqi --share`: public URL via cloudflared, token, CORS, rate limits, control plane off the tunnel by architecture  | Plan 4, PR #6       |
| Packaging: one self-contained tarball, panel inlined, plain Node 20+                                                | Plan 5, PR #7       |
| Data generators: types in ~25 languages from live responses, seeded data from a pasted TS model                     | Plan 6, PR #16      |
| Release pipeline: release-please, tag-triggered npm publish, no prerelease line                                     | Plan 7, PRs #19/#31 |
| Terminal output: one rendering layer for start, failures, goodbye                                                   | Plan 8, PR #21      |
| `laqi init`: scaffold from example, empty, or OpenAPI — five questions, every one with a flag                       | PR #22              |
| English migration: code comments, docs tree, all surfaces                                                           | Plan 9, PR #32      |
| laqi.dev: landing page, three docs pages, shared tokens, deploy on merge                                            | Plan 10, PR #33     |
| Effect-first inside `@laqi/generate`: services, layers, a module-local runtime                                      | ADR-0012, PR #51    |

## In flight

Nothing. `2.0.1` is published, laqi.dev is live, and the Effect-first change
set merged on 2026-09-02.

## Next — committed direction, not yet planned

### Suggested responses on create

Today a new endpoint gets exactly the responses you type. The frequent
reality is that every endpoint wants the same family: the happy path plus
the standard failures for its method. The feature: when an endpoint is
created (panel, MCP, or on observing a real 200 in the request log), offer
to scaffold the usual siblings in one click —

- `GET` → `ok` / `empty` / `not-found` / `error`
- `POST` → `created` / `validation-error` / `conflict`
- `PUT`/`PATCH` → `ok` / `not-found` / `conflict`
- `DELETE` → `deleted` (204) / `not-found`

plus variants driven by the shape of the request (query params, `:id` in
the path → a `not-found` is almost certainly wanted).
**Planned in [Plan 11](/plans/2026-09-02-11-response-scaffolding/)**, together
with the status select below — they share the form and the MCP surface. Bodies come from the
existing data generators, so the scaffolded responses are realistic, not
empty shells. Surfaces: a hint in the panel's create flow, and an MCP
affordance so agents get the same one-call scaffold.

### Package-manager toggle on laqi.dev

The hero's install block and the docs' installation page currently show
`npm` only. laqi is a plain npm package, so every manager already works —
`npm i -g laqi`, `pnpm add -g laqi`, `yarn global add laqi`, `bun add -g
laqi`, plus the no-install runners (`npx laqi`, `bunx laqi`, `pnpm dlx
laqi`) — the site just doesn't say so. The feature: a **toggle that swaps
the command text in place** (npm / pnpm / yarn / bun), not TanStack's
stack of five "or" blocks. One choice, remembered in `localStorage`,
applied to every install snippet across the site. The site is static
Astro, so this is a small client-side island. Before shipping: actually
verify the global-install and runner paths on each manager (yarn classic
vs berry differ on `global`) — that verification is Task 1 of
**[Plan 12](/plans/2026-09-02-12-package-manager-toggle/)**.

### Status-code select on create

In the panel, the status field on the new-endpoint / new-response form is
a free-text input. Replace it with a **select with dropdown listing the
HTTP status codes**, grouped by class and named (`200 OK`, `201 Created`,
`404 Not Found`, `422 Unprocessable Entity`…), with type-to-filter so
`404` or "not found" both reach it. Free text stays possible for exotic
codes. This is the small sibling of "suggested responses on create" above:
the select teaches what codes exist; the scaffold offers the family the
method usually wants. Both are
**[Plan 11](/plans/2026-09-02-11-response-scaffolding/)**.

### The QR for the shared URL

Stage 3's other half. `laqi --share` prints a URL you then have to type into
a phone; a QR removes that. Held back from [Plan
13](/plans/2026-09-02-13-terminal-request-stream/) because it needs a
decision, not just work: **a new published dependency, or a Reed-Solomon
encoder bundled into `@laqi/tui`**. `apps/cli/src/package.test.ts` asserts
the published dependency list exactly, and laqi has taken no new runtime
dependency since v2 — so this is an ADR.

### WebSocket mocking

Mock socket connections, not just request/response. Declare a WS endpoint
in the mock files, script named message sequences the way responses are
named today, and push events manually from the panel (and via MCP) to
drive the client into any state. Design questions to settle first: what
"resolution layers" mean for a stream, and whether the declarative JSON
format stretches to message sequences or needs a new shape. The panel's
SSE infrastructure is adjacent but not reusable — this is a new protocol
surface in `packages/server`. **No plan, deliberately:** the open questions
are written out in
[websocket-mocking](/design/websocket-mocking/), and a plan written before
they are answered would be inventing the answers.

## Later — deferred by explicit rulings

- **Live demo on laqi.dev** — the transport extraction
  (`LaqiTransport`/`MemoryTransport`) in the panel, then a `client:visible`
  demo island with static fallback. Deferred by Ruling 2 (2026-08-29); the
  order is written in [public-site.md](/design/public-site/).
- **Self-hosted relay on Cloudflare Workers** — replaces cloudflared for
  `--share`: stable URLs, no binary dependency. Phase 2 of
  [ADR-0007](/decisions/0007-public-url/), postponed until usage justifies
  it.
- **Panel deep-linking** — URL routing to an endpoint, via standalone
  TanStack Router if ever needed ([ADR-0011](/decisions/0011-panel-plain-react-spa/)).

## Backlog — known defects, Medium/Low

Six findings from the [Plan 6 audit](/plans/plan-06-audit/) were kept
rather than fixed; the sharpest is #6: `firstName`/`lastName` both
generate a **full** name, so the most common pasted model comes out
visibly wrong. The full table lives in the audit.

## Housekeeping

- ~~The [plans index](/plans/) status column is stale.~~ Corrected on
  2026-09-02: plans 6–8 now read Merged, and plans 9–13 are listed. The column
  is still hand-maintained, so it will drift again — deriving it from PR state
  is the durable fix and has not been done.
