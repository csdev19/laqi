---
title: Disposable sandboxes (bun run try) — design spec
---

# Disposable sandboxes (`bun run try`) — design spec

**Status:** Draft. Option C chosen with Cristian on 2026-10-05.
**Date:** 2026-10-05
**Part of:** [Examples, sandboxes and an agent-first CLI](/design/examples/)

## The problem

To watch an agent build something with laqi we need a fresh project, the laqi a user would really
get, and a way to throw it away. Doing that inside the repo means `git reset` / `git clean` dances,
a dirty tree, and agents reading the monorepo instead of the project. Running two agents side by
side (Claude vs Codex, MCP vs CLI-only) is impossible when both share one folder and one port.

## Decision

`bun run try` copies an example into a sandbox **outside the repo tree**, installs laqi there **as a
packed tarball**, gives it its own ports, and prints what to do next. Sandboxes are cattle: listed,
reported on, deleted. Nothing in the flow uses `git reset` or `git clean`.

Rejected: tries inside the repo (`examples/<name>/.tries/`), and branch- or reset-based flows. Both
leak the monorepo into what the agent sees and fight the parallel goal.

## Commands

```
bun run try <example> [--from starter|reference] [--cli local|npm] [--name <n>]
bun run try:list   [--json]
bun run try:clean  <name> | --all | --older-than <days>
bun run try:report <name> [--json]
```

| Flag     | Default                       | Meaning                                                                            |
| -------- | ----------------------------- | ---------------------------------------------------------------------------------- |
| `--from` | `starter`                     | `starter` = the app shell without mocks or API layer; `reference` = the full app   |
| `--cli`  | `local`                       | `local` = `npm pack` of the locally built CLI; `npm` = the published `laqi@latest` |
| `--name` | `<example>-<YYYYMMDD-HHMMSS>` | sandbox folder name, e.g. `claude`, `codex`, `mcp-only`                            |

The scripts live in `scripts/try/` (TypeScript run by Bun) and are covered by `check-types:scripts`.

## Where sandboxes live

```
${LAQI_TRIES_DIR:-$TMPDIR/laqi-tries}/
  _packs/laqi-2.0.1-<gitsha>.tgz      packed CLI, reused while the sha and tree are unchanged
  claude/                              one sandbox
    .try.json                          example, from, cli + version, sha, ports, createdAt
    laqi.config.json                   port written by try
    .env                               LAQI_URL, LAQI_PORT, PORT
    …                                  the example
  codex/
```

`os.tmpdir()` by default: outside the repo, so neither the agent nor git sees the monorepo, and the
OS cleans it eventually. `LAQI_TRIES_DIR` overrides it (e.g. to keep a try across reboots).

## What `try` does

1. **Resolve the CLI.** `--cli local`: `bun run build --filter=laqi`, then `npm pack` in `apps/cli`
   into `_packs/`. Installing the tarball is exactly what a user gets from npm, so a missing file in
   `files`, a broken `bin` or an unbundled dependency fails here, not after a release. `--cli npm`:
   the published version, for comparison.
2. **Copy the template** (see [Starters](#starters)), skipping `node_modules`, `dist`, `.next`,
   `.astro`, `.laqi` and `.turbo`.
3. **Make it standalone.** Rewrite `package.json`: `workspace:*` → `file:<tarball>` (or the npm
   version), `catalog:` → the version from the root catalog; drop `mock:dev`, which points at
   `../../apps/cli`. The sandbox must install with no monorepo around it.
4. **Allocate ports.** One for laqi, one for the app (plus the share port when the example uses
   `--share`). Free ports are found by binding to port 0, and reserved in
   `$LAQI_TRIES_DIR/ports.json` so two tries started in the same second do not collide. They are
   written to `laqi.config.json` (`port`) and `.env` (`LAQI_URL`, `LAQI_PORT`, `PORT`). Examples
   read ports from the environment; this is a requirement on every example.
5. **Install** with `bun install` in the sandbox.
6. **Print next steps:**

   ```
   ✓ try ready · crud-table (starter) · laqi 2.0.1+local (a1b2c3d)

     cd $TMPDIR/laqi-tries/claude
     bun run mock            laqi on http://127.0.0.1:8123 · panel /__laqi
     bun run dev             app on http://127.0.0.1:5241

     MCP — give this to the agent:
     { "mcpServers": { "laqi": { "command": "./node_modules/.bin/laqi",
       "args": ["mcp"], "cwd": "$TMPDIR/laqi-tries/claude" } } }
     claude mcp add laqi -- ./node_modules/.bin/laqi mcp     (run inside the sandbox)

     reset mocks   laqi init --force --from empty
     report        bun run try:report claude
   ```

   The MCP command points at the sandbox's own `node_modules/.bin/laqi`, never `npx laqi`, so the
   agent talks to the build under test.

## Resetting inside a try

| What to reset                       | How                                                    |
| ----------------------------------- | ------------------------------------------------------ |
| Runtime state (overrides, scenario) | `reset_state` / `laqi reset`                           |
| The mocks                           | `laqi init --force --from empty` (or `--from example`) |
| Everything                          | `try:clean <name>` and `try` again                     |

## Starters

Each example has a committed **reference** (the full app, a workspace member) and a **starter**
derived from it. Keeping starters cheap is the point: a starter is a _diff_ against the reference,
not a second app.

```jsonc
// examples/crud-table/try.json
{
  "starter": {
    "remove": ["laqi", "src/api", "src/models"],
    "overlay": "starter"
  },
  "env": { "app": "PORT" },
  "report": { "typesFile": "src/api/types.ts", "build": "build" }
}
```

- `try --from starter` copies the reference, deletes `remove`, then copies `examples/<name>/starter/`
  on top. The overlay holds only the files that must differ (typically one or two: a page that
  renders a placeholder instead of calling the API).
- `starter/` is excluded from the example's `tsconfig`, lint and build.
- A CI check runs `try --from starter` for every example and asserts it installs and type-checks
  (with the API layer missing by design, the check is `tsc` on the overlay's entry points only). If
  the reference moves and the overlay no longer applies, this fails.

## `try:list` and `try:clean`

- `try:list`: name, example, from, cli version, ports, age, size, and whether its laqi is running
  (a `GET /__laqi/api/status` on its port). `--json` for scripts.
- `try:clean` refuses any path that does not resolve inside `$LAQI_TRIES_DIR`, and stops a laqi it
  finds running on the sandbox's port first. It also releases the ports in `ports.json`.

## `try:report` — the seed of agent evaluation

`try:report <name>` compares a sandbox with its example's reference and prints a short summary
(Markdown; `--json` for aggregation across runs):

| Check      | How                                                                                      |
| ---------- | ---------------------------------------------------------------------------------------- |
| Endpoints  | `laqi endpoints --json` in both; missing / extra endpoint ids                            |
| Responses  | per endpoint: missing / extra response names and statuses                                |
| Data       | array lengths of `ok` bodies; seeded vs hand-written (does the response carry a schema?) |
| Types file | `report.typesFile` exists and type-checks                                                |
| App builds | `report.build` script exits 0                                                            |
| Smoke      | start laqi on the sandbox port, `curl` every `GET` default, compare statuses             |

It scores; it does not judge prose or UI. Two runs (Claude vs Codex, MCP vs CLI-only) are compared
by diffing their `--json` reports. That is the first concrete step of the "repeatable agent
evaluation of MCP tool descriptions" item in [agent-facing-docs](/design/agent-facing-docs/).

## CI

The examples' smoke job is `try` in a non-interactive mode:

```
bun run try <example> --from reference --cli local --name ci-<example> --smoke
```

`--smoke` = after installing: run the example's `build`, start laqi on its allocated port, `curl`
the endpoints listed in `try.json` (and the `CI` rows of the
[coverage matrix](/design/examples/#coverage-matrix)), stop laqi, exit non-zero on the first
failure. One matrix leg per example.

## Out of scope

- Driving the agent itself. `try` prepares the room; a person (or a later harness) starts Claude or
  Codex in it.
- Windows paths beyond what `os.tmpdir()` gives for free.
- Package managers other than Bun inside the sandbox (an `--pm npm` flag is cheap if it is ever
  needed).
