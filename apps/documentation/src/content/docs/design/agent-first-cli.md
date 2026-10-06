---
title: An agent-first CLI — MCP parity — design spec
---

# An agent-first CLI — MCP parity — design spec

**Status:** Draft. Direction agreed with Cristian on 2026-10-05; verb names are proposals.
**Date:** 2026-10-05
**Part of:** [Examples, sandboxes and an agent-first CLI](/design/examples/)

## The problem

Everything an agent can do to the mocks — create an endpoint, generate data, export types, import
OpenAPI, flip a response — exists only as an MCP tool. The CLI has `start`, `init`, `mcp` and
`migrate`. An agent without MCP configured (a CI job, a fresh Codex session, a sandbox nobody
wired up) falls back to hand-editing JSON, which is exactly what laqi is supposed to remove.

A shell is the one interface every agent already has. This spec is also the source for Cristian's
planned post _"Un CLI pensado para agentes, no para humanos"_.

## What the code already gives us

- The MCP tools are thin over `Project` in `@laqi/core`: `listEndpoints`, `getState`,
  `createEndpoint`, `updateEndpoint`, `deleteEndpoint`, `scaffoldResponses`, `setResponse`,
  `setScenario`, `resetState`, `applyGeneratedBody`, `refreshSchema`. They return `ProjectResult`
  (`ok` / `error`).
- `Project` works on **files**: definitions in `laqi/`, live state in `.laqi/state.json`
  ([ADR-0004](/decisions/0004-state-outside-git/)). A running server reads state on every request
  and its watcher reloads definitions, so a write takes effect immediately — and is safe while the
  server is stopped.
- Not in `Project` today: the bodies of `get_types`, `generate_data`, `regenerate_response` and
  `import_openapi` (`packages/mcp/src/openapi.ts`) live in the MCP package.

## Decisions

1. **One core, two adapters.** Step 0 moves the logic that lives in MCP handlers today into a shared
   operations module (in `@laqi/core`, or a small `@laqi/ops` if `@laqi/generate`'s weight must stay
   out of core). MCP tools and CLI verbs become adapters: parse input → call the operation → render
   the `ProjectResult`. No logic is written twice.
2. **Files, not the control plane.** CLI verbs go through `Project`, like MCP — including the
   runtime-state verbs (`set`, `scenario`, `reset`, `state`). That means no port discovery, no
   "is laqi running?", and the same behaviour with the server up or down. The control plane
   (`/__laqi/api/*`) stays the panel's transport; the CLI does not depend on it.
3. **Mechanical parity.** Every write verb accepts `--input <file|->`: the exact JSON the MCP tool
   takes. Flags are sugar over that input. A test enumerates the registered MCP tools and fails if
   one has no verb (the same idea as `documented-tools.test.ts`).
4. **Agent-first defaults.** `--json` on every verb; stable exit codes; stdout is data, stderr is
   chatter; non-TTY never prompts (as `laqi init` already does).

## Addressing

- An endpoint is its id, quoted: `"GET /customers/:id"` — the same string MCP uses.
- A response is `<endpoint>#<name>`: `"GET /customers#ok"`. `#` cannot appear in a route path, so
  this is unambiguous. Where a verb takes one endpoint and an optional response, `--response <name>`
  works too; omitted means the endpoint's default, as in MCP.
- Bodies: `@file.json`, `-` for stdin, or inline JSON.

## Parity table

| MCP tool               | CLI verb                                                                                                 | Kind                       |
| ---------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------- |
| `list_endpoints`       | `laqi endpoints`                                                                                         | read                       |
| `get_state`            | `laqi state`                                                                                             | read                       |
| `get_types`            | `laqi types "<id>" [--response r] [--lang ts] [--out file]`                                              | read                       |
| `generate_data`        | `laqi generate --model f.ts [--type T] \| --schema f.json \| --from "<id>#r"` `[--count n] [--seed n]`   | read (preview)             |
| `apply_generated_body` | `laqi generate … --into "<id>#r"` (preview + apply in one), or `laqi apply preview.json --into "<id>#r"` | write                      |
| `regenerate_response`  | `laqi regenerate "<id>#r" [--count n] [--seed n] [--write]`                                              | read; write with `--write` |
| `refresh_schema`       | `laqi refresh-schema "<id>#r" [--allow-loss]`                                                            | write                      |
| `create_endpoint`      | `laqi add "<id>" --response ok:200:@ok.json [--response …] [--default ok] [--description …]`             | write                      |
| `update_endpoint`      | `laqi update "<id>" [--response …] [--default …] [--description …]`                                      | write                      |
| `delete_endpoint`      | `laqi remove "<id>" --yes`                                                                               | write                      |
| `scaffold_responses`   | `laqi scaffold "<id>"`                                                                                   | write                      |
| `import_openapi`       | `laqi import <spec.json> [--overwrite] [--allow-loss]`                                                   | write                      |
| `set_response`         | `laqi set "<id>" <response>` · `laqi set "<id>" --clear`                                                 | state                      |
| `set_scenario`         | `laqi scenario <name>` · `laqi scenario --off` · `laqi scenario` (list)                                  | state                      |
| `reset_state`          | `laqi reset`                                                                                             | state                      |

Notes:

- `--response name:status[:body]` covers the common case; anything richer (`delay`, `headers`,
  several responses with schemas) goes through `--input`.
- `generate --into` reads the revision, previews and applies in one call; the revision check that
  `apply_generated_body` enforces still runs, so a concurrent edit fails with exit 7 instead of being
  overwritten. The two-step form exists for agents that show the preview to a person first.
- `--allow-loss` keeps the MCP rule: refused by default, naming what would be approximated.
- `remove` needs `--yes` (or a TTY confirmation); it is the one destructive verb.
- `laqi import` and `laqi init --from openapi` share the importer.

## Conventions

**Help.** `laqi --help` gains two groups, _Edit mocks_ and _Live state_. `laqi <verb> --help` shows
usage plus two runnable examples. `laqi commands --json` prints a manifest of every verb, its flags
and the MCP tool it mirrors, generated from the same table the parity test reads — an agent can
discover the CLI the way it discovers MCP tools.

**`--json`.** Success: stdout is one JSON document, the operation's value — the same payload the MCP
tool returns as text. Failure:

```json
{ "ok": false, "error": { "code": "not-found", "message": "No endpoint GET /customer. Did you mean GET /customers?", "remedy": ["laqi endpoints"] } }
```

**Human output.** Success is one or two lines (`✓ added GET /customers · 3 responses · laqi/customers.json`).
Failure is the existing `renderFailure` shape on stderr ([terminal-output](/design/terminal-output/)):

```
✗ could not add GET /customers

  GET /customers already exists in laqi/customers.json.

  try   laqi update "GET /customers" --response ok:200:@customers.json
  or    laqi remove "GET /customers" --yes

  nothing was written · exit 7
```

**Exit codes.** The existing 1–5 keep their meaning; three are added, still inside the fatal range
1–9:

| Code | Meaning                                                                 |
| ---- | ----------------------------------------------------------------------- |
| 0    | done                                                                    |
| 1    | unknown / unhandled                                                     |
| 2    | no mock folder, or it is empty                                          |
| 5    | bad flag or argument                                                    |
| 6    | not found — endpoint, response or scenario                              |
| 7    | refused — already exists, revision changed, loss without `--allow-loss` |
| 8    | invalid input — body, model or OpenAPI document does not validate       |

**Root.** Verbs honour `--dir`, `--file` and `laqi.config.json` exactly as `laqi start` does.

## Delivery

- **c1 — plan-first.** Extract the operations; ship the read verbs (`endpoints`, `state`, `types`,
  `generate` preview, `scenario` list) and `laqi commands --json`. MCP behaviour must not change:
  the existing MCP stdio tests are the guard.
- **c2.** The write and state verbs, `--input`, and the parity test. `feat(cli)`, so it reaches npm.
- Then update `apps/cli/README.md` (the npm page) and the init-generated `laqi/README.md`, which is
  what an agent without MCP reads ([agent-facing-docs](/design/agent-facing-docs/)).

## Out of scope

- An interactive TUI for these verbs. They are for scripts and agents first; people have the panel.
- Talking to a remote laqi (through `--share`). The tunnel never carries `/__laqi`, by design.
