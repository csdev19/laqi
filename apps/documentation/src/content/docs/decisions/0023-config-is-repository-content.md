---
title: ADR-0023 — laqi.config.json is repository content: closed, project-relative, fail closed
---

# ADR-0023 — `laqi.config.json` is repository content: closed, project-relative, fail closed

**Status:** Proposed
**Date:** 2026-10-12
**Spec:** [Schema validation rules](/design/schema-validation-rules/) (NIW2-315)

## Context

`laqi.config.json` lives at the project root and is committed, like `laqi/`
([ADR-0008](/decisions/0008-multifile-and-names/): no dot means it is yours
and gets committed). It carries three settings that are security policy, not
preference: `cors` (which browser origins may read the mocks, never `*` when
shared per [ADR-0007](/decisions/0007-public-url/)), `schemaSources.root`
(where laqi may read project files from), and `mcp.modules` (the only project
code an agent may execute, [json-schema-adapters](/design/json-schema-adapters/)).

Today the file is parsed with a schema that strips unknown keys and accepts
any string as a path, and an invalid file is replaced by the defaults
(`cors: '*'`, root `.`, no modules) with a notice. A developer who clones a
repository and runs `npx laqi` therefore executes a policy written by whoever
last committed that file — and if that policy is malformed, a weaker one.

This is the class of problem VS Code's Workspace Trust addresses for
`.vscode/tasks.json`: configuration that ships with the clone must not be
able to reach outside the folder or to silently widen what the tool does.

## Decision

1. **Closed.** The config file is validated with a strict schema at every
   level. An unknown key is an error, not a stripped no-op. `$schema` is the
   one tolerated extra key, for editors.
2. **Project-relative.** Every path in the file (`dir`, `file`,
   `schemaSources.root`, `mcp.modules[].file`) must be relative, without `..`,
   drive letters, UNC prefixes or NUL. The check is lexical and lives in
   `@laqi/schema`; symlink-aware confinement at read and write time remains
   the consumers' job and is not replaced.
3. **Fail closed.** An unparsable or invalid file stops `laqi start`,
   `laqi mcp` and `laqi migrate` with a fatal report naming every issue and
   exit code 5. There is no fallback to defaults.
4. **Mock files are closed too, but not fatal.** `EndpointSchema` and
   `ResponseSchema` refuse unknown keys. On load an endpoint whose only
   problem is an unknown key is still served and reported as `degraded` with
   file, line and key; a write that carries one is refused. This keeps
   ADR-0008's "loud, with file and line, and not fatal" for mock files while
   ending the silent loss of hand-written keys on the next panel or MCP save.
5. **Flags are not the file.** `--dir` and `--file` typed on the command line
   keep accepting any path, including outside the project. The person at the
   shell is trusted; the clone is not.

## Alternatives rejected

- **Warn and continue with defaults** (today). The defaults are the weakest
  policy laqi has; a warning under the start screen is the notice an attacker
  counts on being scrolled past.
- **Warn, then error in a later major.** Right when a user cannot act on the
  message; wrong here, where every message names the file, line and fix, and
  where the file is repository content. It would also cost two majors.
- **Preserve unknown keys as extension data.** Fixes the data loss, keeps the
  typo silent, and invites agents to stash state in mock files.
- **An opt-in key inside the file** (`"trustOutside": true`, `"strict": true`).
  Approval written in the untrusted file is not approval.
- **Reject absolute paths on the flags as well.** One rule is simpler, but an
  external `--dir` is a tested capability and the threat is not the shell.

## Consequences

- `laqi@3.0.0`: every rule changes what a committed file may contain and is a
  breaking change under semver. All validation tightening from NIW2-315 ships
  in that one major; there is no rewrite command, because nothing refused has
  a meaning-preserving mechanical fix.
- A CI job running `npx laqi` against a broken config now fails instead of
  serving with `cors: '*'`.
- Monorepos whose types live in a sibling package cannot point
  `schemaSources.root` at `../…` from the file. They run laqi from the
  workspace root, or wait for the trust prompt below.
- A typo in a committed mock file becomes a visible `degraded` entry and
  blocks edits to that endpoint until fixed.

## Non-goals

- A sandbox or trust store for `mcp.modules` (NIW2-310 owns repo-local trust).
- Symlink-aware confinement of `dir` / `file` (NIW2-313).
- Validating `.laqi/state.json` strictly; it is machine-written.
- A published JSON Schema for the config file.

## Reopen condition

- NIW2-310 ships a person-facing trust prompt for repository-local decisions.
  Then "a config may name a path outside the project if the person approved
  this clone" becomes expressible, and rule 2 should gain that exception.
- A second committed configuration source appears (per-user overrides,
  `laqi.config.local.json`). The split between trusted and untrusted inputs in
  rule 5 must then be restated for it, not assumed.
