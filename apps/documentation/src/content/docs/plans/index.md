---
title: Implementation plans
---

# Implementation plans

v2.0.0 was built in six plans (plan 2 was split in two so each could close with
its own PR). Each one produces working software that can be tested on its own,
and they run in order.

**All six are done**, and the result went through an
[adversarial audit](/planes/auditoria-v2/) in two rounds: 26 findings, all
closed. A further plan, built on top of the finished v2.0.0, is below the
table. Plans from 7 onward are post-v2.0.0 work.

| #   | Plan                                                                      | Delivers                                                                                                                                                                                                                                                                   | Status                                                       |
| --- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| 1   | [Foundation and mock server](/planes/2026-08-24-01-fundacion-y-servidor/) | `laqi` runs and serves mocks from `laqi.json` or `laqi/`, with validation, hot-reload and the four resolution layers. Plus `laqi migrate`. **13 tasks, ~95 tests.** Audited: [audit](/planes/auditoria-plan-01/).                                                          | **Merged** — [PR #1](https://github.com/csdev19/laqi/pull/1) |
| 2a  | [Control plane](/planes/2026-08-24-02a-control-plane/)                    | `/__laqi/api/*` (endpoint CRUD, state, scenarios, status) and a live SSE request stream, on `packages/server`. The structural separation Plan 4 needs in order to keep `/__laqi` off the tunnel (H1) — the blocking itself is that plan's job. **11 tasks, 50 new tests.** | **Merged** — [PR #3](https://github.com/csdev19/laqi/pull/3) |
| 2b  | [Web editor](/planes/2026-08-25-02b-editor-web/)                          | `packages/editor` (React + Vite), served at `/__laqi`, consuming 2a's contract. Closes two gaps in 2a's request event (no-route emitted nothing, the path was the route pattern). **37 panel tests.**                                                                      | **Merged** — [PR #4](https://github.com/csdev19/laqi/pull/4) |
| 3   | [MCP server](/planes/2026-08-25-03-servidor-mcp/)                         | `packages/mcp` and `laqi mcp`: nine tools over stdio, including `import_openapi`. Closes three write-validation holes ADR-0006 warned about. **62 tests, 14 over real stdio.**                                                                                             | **Merged** — [PR #5](https://github.com/csdev19/laqi/pull/5) |
| 4   | [Public URL](/planes/2026-08-25-04-url-publica/)                          | `laqi --share` via cloudflared. H1 closed by architecture: a second listener that mounts only the mocks is what the tunnel sees. Bearer token, restricted CORS, rate limiting. **Verified live.**                                                                          | **Merged** — [PR #6](https://github.com/csdev19/laqi/pull/6) |
| 5   | [Docs and packaging](/planes/2026-08-25-05-empaquetado/)                  | A tsdown build: one package with the panel inside it, verified from a real tarball on plain Node with bun off the PATH. Closes the SSE leak that had been deferred.                                                                                                        | **Merged** — [PR #7](https://github.com/csdev19/laqi/pull/7) |

Further plans, past v2.0.0 itself, build on top of it:

| #   | Plan                                                                   | Delivers                                                                                                                                                                                                                                                                           | Status                                                            |
| --- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| 6   | [Data generators](/planes/2026-08-27-06-data-generators/)              | Types in 27 languages derived from live response data, and seeded mock data generated from a pasted TypeScript model — both from the panel, the control-plane API and MCP tools. Audited: [audit and backlog](/planes/auditoria-plan-06/) — 11 findings, the five High ones fixed. | **In review** — [PR #16](https://github.com/csdev19/laqi/pull/16) |
| 7   | [Release and publishing](/planes/2026-08-28-07-release-y-publicacion/) | release-please with a single version line, a tag-triggered npm publish on the `beta` dist-tag, and a PR gate for format, lint, types and tests. Decided in [ADR-0010](/decisiones/0010-release-y-npm/).                                                                            | **Planned**                                                       |
| 8   | [Terminal output, stage 1](/planes/2026-08-28-08-terminal-output/)     | One rendering layer for start, failures and goodbye, plus the session counters the summary reads. Designed in [terminal-output](/diseno/terminal-output/).                                                                                                                         | **Planned**                                                       |

## Why this order

Plan 1 is the only one that depends on nothing, and everything else depends on
it: the control plane, the MCP server and the tunnel all operate on the route
table and the state store that `packages/core` builds.

Plan 1 is also **a usable product on its own**: a correct mock server, with
v1's twelve defects fixed and the new format. If everything stopped after it,
what remained would still be worth having.

Each plan was written once the previous one had been executed, never before —
so each one builds on real code rather than on assumptions.

## Context every plan assumes

- [ADRs 0001–0008](../decisiones/) — the structural decisions
- [Concepts](../conceptos/) — the three writers and state resolution
- [Control panel design](../diseno/) — above all [design](/diseno/design/)
  (API contracts) and [state-model](/diseno/state-model/)
- [Design review](/diseno/revision-vs-decisiones/) — the 13 findings, split
  across the plans they belong to

## Coverage of v1's twelve defects

All twelve from the [analysis](/analisis-v1/) are closed in Plan 1, except one:

| Defect                                 | Where                                               |
| -------------------------------------- | --------------------------------------------------- |
| A — state leaking between requests     | Task 10 (`structuredClone`, with a regression test) |
| B — `return` where `continue` belonged | Tasks 4 and 6 (per-key validation)                  |
| C — hung request                       | Tasks 9 and 10 (every path ends in a response)      |
| D — collision between files            | Task 7                                              |
| E — `(generate:uid)` never implemented | **Outside Plan 1** — templating in a later plan     |
| F — watcher with a hardcoded path      | Task 12 (comes from the config)                     |
| G — only listened for `change`         | Task 12 (`add`/`change`/`unlink`, with tests)       |
| H — concurrent restarts, EADDRINUSE    | Task 12 (debounce + hot-swap, with a test)          |
| I — status codes as strings            | Tasks 2 and 13                                      |
| J — `yargs` declared and unused        | Task 12 (`node:util.parseArgs`, zero dependencies)  |
| K — `nodemon` in `dependencies`        | Task 1                                              |
| L — no tests at all                    | The whole plan (TDD throughout)                     |
