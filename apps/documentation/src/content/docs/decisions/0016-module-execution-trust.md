---
title: ADR-0016 — Running project code needs a decision made outside the channel that asked
---

# ADR-0016 — Running project code needs a decision made outside the channel that asked

**Status:** Proposed
**Date:** 2026-10-12
**Ticket:** [NIW2-310](https://linear.app/niway/issue/NIW2-310)
**Spec:** [Module execution trust — design spec](/design/module-execution-trust/)
**Amends:** the "Executing project code" rules of the [JSON Schema adapters spec](/design/json-schema-adapters/#executing-project-code). Does not contradict any accepted ADR; extends [ADR-0006](/decisions/0006-mcp-server/)'s "strictly scoped" consequence from writes to execution, and follows [ADR-0004](/decisions/0004-state-outside-git/)'s habit of keeping machine-local decisions out of the repository.
**Implementation:** none yet. Nothing in `main` implements this decision.

## Context

laqi reads schemas out of the user's own TypeScript (`project-module` sources) by
importing the file in a child process. Importing runs the module and everything it
imports, with the developer's permissions. The adapters spec bounded _who may trigger_
that, not what the code does, and chose two gates: a prepare/confirm pair on the local
HTTP control plane for the panel, and a hand-written allowlist `mcp.modules` in
`laqi.config.json` for agents.

The audit showed both gates are decided by the party asking. `prepare` returns a token
to its caller and `confirm` accepts it from the same caller
(`packages/server/src/control-plane-app.ts:756-806`); the person who sees the resolved
path in the panel is a UI convention the server cannot observe, and the token is derived
from `Math.random` (`packages/core/src/module-permission.ts:81-83`). The allowlist ships
inside the repository, so a cloned repository approves its own file for execution by an
agent (`apps/cli/src/index.ts:44-77`, `packages/mcp/src/server.ts:434-446`). On top of
that, `generate_data` tells MCP hosts it is read-only while being the tool that runs
the module (`packages/mcp/src/server.ts:400`).

Other developer tools met the same problem and converged on one shape: the decision to
run something that came with a folder is recorded somewhere the folder cannot reach.
VS Code opens unfamiliar folders in Restricted Mode and keeps the trusted list in the
user profile; direnv refuses an `.envrc` until `direnv allow` records it, and again after
every edit; mise hashes config files and re-asks when they change; pnpm 10 stopped running
dependency build scripts until they are listed and approved. mise also showed the failure
mode to avoid: in CVE-2026-35533 a project's own config could relocate the trust list and
set `yes = true` to answer its own prompt.

## Decision

**A load of project code happens only after a decision laqi received on a channel the
requester can neither read nor write.** Concretely:

1. **Panel.** `prepare` prints a short, CSPRNG-generated approval code in laqi's own
   terminal and returns only a token over HTTP. `confirm` needs the token and the code.
   One wrong code spends the token; three wrong codes lock module loads for a minute.
   The code never appears in any HTTP response.
2. **Agents.** A module listed in `mcp.modules` runs only if a person has approved it on
   this machine with `laqi trust`, which is interactive, TTY-only, has no `--yes`, and
   writes to a user-level store (`$XDG_CONFIG_HOME/laqi/trusted-modules.json`) outside
   any project. The record is bound to the module's resolved real path, export, side and
   the sha256 of its content; any change to the file revokes it.
3. **The store cannot be supplied by a repository.** A store located under the project
   root, not owned by the current user, or readable by others is treated as empty. There
   is no laqi-specific environment variable or config key that relocates it.
4. **Annotations tell the truth.** The MCP path that executes code is its own tool,
   `generate_from_module`, with `readOnlyHint: false`; `generate_data` stays read-only
   and refuses modules.
5. **Self-asserted approval is never read.** No `confirmed: true`, no `--yes`, no `CI`
   or `yes` setting, no claim in a tool input counts as approval on any surface.

The child process remains a lifecycle boundary, not a sandbox, but it gets an
allowlisted environment, bounded output, a dedicated verdict channel and an in-child
digest check so that what runs is what was approved.

## Alternatives rejected

- **A per-session secret delivered in the panel HTML** — proves the request came from
  code that read the panel, not that a person decided; any local process can read it.
  Good CSRF control (NIW2-309), not approval.
- **A `y/N` prompt on the server's stdin** — `laqi start` often has no TTY (turbo,
  concurrently, scripts); a prompt under a request log is answered by accident. Kept as a
  possible accelerator, not the mechanism.
- **Trust the config's `mcp.modules` by hashing the config** — the executing file can
  change without the config changing; direnv and mise hash the thing that runs.
- **Trust by path only (VS Code style)** — survives a hostile commit to the trusted file;
  laqi knows exactly which file runs and can bind to its bytes.
- **MCP elicitation as the agent-side approval** — laqi cannot tell a person's `accept`
  from an auto-accepting client, the spec forbids eliciting sensitive data, and host
  support is uneven; `laqi trust` is needed regardless.
- **`node --permission` on the child** — absent under a Bun parent, follows symlinks out
  of the granted paths (documented), and real schema libraries need the capabilities it
  would deny; it would be a boundary that exists only sometimes.
- **Drop `readOnlyHint` from `generate_data`** — makes the harmless, common path prompt
  in every host that honours annotations.

## Consequences

**In favour.**

- No HTTP or MCP caller can approve its own execution; the audit's highest-impact sink
  closes without a sandbox claim laqi cannot keep.
- A freshly cloned repository cannot run code through laqi's agent surface until a
  person at a terminal looked at the file name and hash. A `git pull` that changes a
  trusted module fails closed with a message that says what to do.
- Hosts that gate on annotations gate exactly the dangerous tool.

**Against, accepted knowingly.**

- One more step in the panel (read a code from the terminal) every time a module is
  imported, and a `laqi trust` run per machine and per edit of each listed module. The
  refusal messages name the command every time.
- Headless or CI runs of `laqi mcp` cannot execute modules at all. There is no person,
  so this is correct, but it is a behaviour change for anyone who relied on it.
- Two breaking changes for users of the npm package: `generate_data` no longer accepts
  `project-module`, and `mcp.modules` entries stop working until approved.
- The trust store is one more file on the machine, with its own format to keep stable.

## Non-goals

- Containing what an approved module does. The child is a lifecycle boundary; the docs
  keep saying so in those words.
- Hashing a module's transitive imports. Approval covers the listed file at its
  content; its imports are the project's dependency tree, which the project's own
  scripts already execute.
- Approving modules from the MCP host's UI (elicitation) or from the panel for agents.
- Validating `laqi.config.json` path fields in general (NIW2-315) or the control
  plane's origin and header policy (NIW2-309).

## Reopen when

- A major MCP host documents that elicitation responses are always produced by the
  person and never by the model or an auto-accept setting — then an elicitation-based,
  session-only approval for agents is worth designing.
- The published package can require a runtime with a uniform permission model (Node ≥ 24
  only, or Bun ships one), at which point `--permission` on the child becomes a second
  layer worth its allowlist maintenance.
- Users report that re-trusting after every edit is the reason they stop using
  `project-module`, which would argue for trusting the file's path plus the hash of the
  config entry instead of the content, with the loss of protection stated.
- A way is found for any local process to read laqi's stdout that does not already give
  it the developer's shell, which would mean the terminal is no longer a channel the
  requester cannot read.
