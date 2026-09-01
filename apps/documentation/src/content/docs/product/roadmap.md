---
title: Roadmap
description: What has shipped, what is in flight, and what comes next — the single place to answer "what's the state of laqi".
---

# Roadmap

**Last reviewed: 2026-09-01.** Statuses here are verified against merged
PRs, not against plan documents (the [plans index](/plans/) lags behind —
it still lists as "Planned" work that has merged).

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

## In flight

- **laqi.dev** — public landing + user docs (Plan 10, branch
  `feat/laqi-dev-site`). Deploys to Cloudflare Pages on merge.
- **Publishing `2.0.0`** — the release PR exists; merging it _is_ the
  launch. Constraint: publish before or with the site, never after — a live
  laqi.dev whose hero installs the 2022 v1 is worse than no site.

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
the path → a `not-found` is almost certainly wanted). Bodies come from the
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
vs berry differ on `global`).

### Status-code select on create

In the panel, the status field on the new-endpoint / new-response form is
a free-text input. Replace it with a **select with dropdown listing the
HTTP status codes**, grouped by class and named (`200 OK`, `201 Created`,
`404 Not Found`, `422 Unprocessable Entity`…), with type-to-filter so
`404` or "not found" both reach it. Free text stays possible for exotic
codes. This is the small sibling of "suggested responses on create" above:
the select teaches what codes exist; the scaffold offers the family the
method usually wants.

### WebSocket mocking

Mock socket connections, not just request/response. Declare a WS endpoint
in the mock files, script named message sequences the way responses are
named today, and push events manually from the panel (and via MCP) to
drive the client into any state. Design questions to settle first: what
"resolution layers" mean for a stream, and whether the declarative JSON
format stretches to message sequences or needs a new shape. The panel's
SSE infrastructure is adjacent but not reusable — this is a new protocol
surface in `packages/server`.

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

- The [plans index](/plans/) status column is stale (plans 6–8 show
  "Planned"/"In review" but are merged). Update it or derive it from PRs.
