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

### Terminal output, stages 2 and 3

Stage 1 shipped in Plan 8 — the start, failure and goodbye screens, and the
session counters. What the design doc
([terminal-output](/design/terminal-output/)) still describes as pending:
**the request stream in the terminal** and **the four keys** (`o` panel, `s`
share, `c` clear, `q` quit), which stage 1 deliberately did not advertise
because none of them were bound. Then **share polish**: `via public` on
streamed requests, and a QR for the phone case.

Planned in **[Plan 13](/plans/2026-09-02-13-terminal-request-stream/)**, which
covers the stream, the keys and `via public`. The QR is held back there: it
needs either a new published dependency or a Reed-Solomon encoder bundled into
`@laqi/tui`, and `apps/cli/src/package.test.ts` asserts the dependency list
exactly — so that is an ADR, not a task.

This section is new. The work existed in the design doc and in the plan index,
and never appeared here, which is how it went unnoticed.

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

### Scaffolding from the request log

Plan 11 shipped the response scaffold in the panel's detail pane and as an
MCP tool. The roadmap's original description also promised it "on observing
a real 200 in the request log" — that trigger is **not** built. It needs an
affordance on the log row, which is a different surface from the create
flow.

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
