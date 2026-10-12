---
title: Cross-cutting audit — findings and spec handoff (2026-10-12)
---

# Cross-cutting audit — findings and spec handoff

**Date:** 2026-10-12
**Status:** Working document.

* **Done:** the findings are recorded in Linear.
* **Not done:** the specs for the resulting tickets. The spec run was interrupted before any agent wrote output.
* **Linear:** NIW2-348, under the umbrella NIW2-302.
* **Lifetime:** delete this file in the PR that lands the last spec.

## One-minute summary

The repository was reviewed as a whole by six agents, as a second pass after the per-package audit tracked in NIW2-302:

* code review (Sonnet);
* architecture (Sonnet);
* documentation discrepancies (Sonnet);
* design patterns (Sonnet);
* application security (Sonnet);
* supply-chain and contribution risk (Opus), which read the live repo settings with `gh api`.

**Audited branch:** `feat/hero-demo`. `main` was about 20 commits ahead at the time, so every finding must be re-checked on `main` before it is fixed.

**Baseline:** `bun run check-types` was clean, and `bun run test` passed (114 files, 1556 tests). None of the findings below is caught by the suite.

**Headline:** for a consumer, installing laqi is low to moderate risk. For the project itself the risk is high: one stolen credential with push access can publish `laqi@latest` with no second check, because `main` and the `production` environment are unprotected.

## Ticket map

| Ticket | Priority | Topic | Needs a spec | Suggested spec model |
|---|---|---|---|---|
| NIW2-330 | Urgent | GitHub/npm settings: environments, rulesets, security toggles | No, owner-only settings | — |
| NIW2-331 | High | Release workflow hardening, CODEOWNERS, SECURITY.md, PR guardrails | Yes | Opus 5.5 |
| NIW2-332 | High | Module loader times out on modules that keep a handle open | Yes, short | Opus 5.5 |
| NIW2-333 | High | `apply_generated_body` body/evidence desync and forged evidence | Yes, short | Opus 5.5 |
| NIW2-338 | High | User-facing docs that contradict the CLI | Yes, short | Opus 5.5 |
| NIW2-334 | Medium | Shared schema/generate service for the CLI and MCP | Yes, with an ADR | Fable |
| NIW2-335 | Medium | Browser-safe core entry; single layer-precedence implementation | Yes | Opus 5.5 |
| NIW2-336 | Medium | Bundle dependency contract and a Node 20/22 smoke test | Yes | Opus 5.5 |
| NIW2-339 | Medium | Delete merged plans; reconcile the index, roadmap and docs README | Yes, short | Opus 5.5 |
| NIW2-340 | Medium | Architecture page and ADR-0005 versus the real package graph | Yes, short (doc fix) | Opus 5.5 |
| NIW2-337 | Low | 92 MB install footprint | Yes, with an ADR | Fable |

Findings that overlapped the first-pass tickets were appended to them, in a section called "Additional findings (cross-cutting review)":

* **NIW2-309:**
  * the CSRF guard's method list is hard-coded;
  * control-plane routes have no error boundary;
  * `arrayLength` is uncapped over HTTP.
* **NIW2-313:** the details of the lock reclaim and release race.
* **NIW2-314:**
  * `generate_data` silently ignores `from`;
  * OpenAPI import reprocesses the whole document per response;
  * path-item `$ref`s are unhandled.

## Spec run: what happened

Six Fable agents were launched, one per group:

* 334;
* 337;
* 331 and 336;
* 332 and 333;
* 335 and 340;
* 338 and 339.

Each was to write a spec, plus an ADR where one was warranted, on the ticket's Linear branch and open a draft PR.

**First attempt.** All six stopped at their first step when the session usage limit hit.

**Second attempt.** They were resumed, created worktrees, and then stopped on the Fable model limit before writing anything. The empty worktrees and branches were removed. Nothing was pushed.

**Push blocker found on the way.**

* The `github-csdev` SSH alias (the laqi remote) returned `Permission denied (publickey)` for one agent and hung for another.
* `git fetch` from this machine also failed with an access-rights error.
* Fix this before relaunching: load the key, or push over HTTPS with the `gh` token for `csdev19` without changing the remote.

## Resume plan

1. Fix push access (see above).
2. The owner chooses the model per group. Design work runs on Fable, Opus 5 or astra-gpt-6, and the owner decides. The recommendation is in the ticket map above.
3. Relaunch each group with the prompt template below. Each agent works in its own worktree created from `origin/main`, never in the main checkout. It commits, pushes, opens a draft PR and removes the worktree.
4. Add a `Spec:` line to each ticket. Add the `night` label only once the spec is merged.

### Spec prompt template

Each agent receives:

* the ticket's findings, copied from Linear;
* its branch name, which is the Linear `gitBranchName`;
* the following rules.

Rules for each agent:

* **Re-verify every finding on `origin/main`** and state which claims still hold.
* **Read before designing:** `architecture/`, all of `decisions/`, `design/index.md` and two or three sibling specs (for frontmatter and style), plus `~/Documents/Workspace/Personal/general-knowledge` where it is relevant. Check `gh pr list` for overlap.
* **Write the spec** to `apps/documentation/src/content/docs/design/<slug>.md` and register it in `design/index.md`.
* **Opening block:** the spec opens with a block readable in one minute: summary, a decisions table (decision, why, and the ADR it creates or reuses, or none), open questions, and out of scope. Detail goes below.
* **Research and challenge:** research the state of the art for architectural choices and cite sources. Argue against the ticket's proposed direction where there is a real case.
* **ADRs:** create an ADR in `decisions/` only for a decision a later reader will question, with status Proposed. If the design contradicts an existing ADR, name it and say whether its reopen condition is met.
* **Do not implement.** Never write to `docs/superpowers/`.
* **Landing:** commit with the attribution trailer, push, and open a draft PR titled `spec: <topic> (NIW2-XXX)`. Do not merge, and do not edit Linear.

### Known overlaps to give the agents

* **First-pass tickets in flight.** NIW2-309 to NIW2-316 are being implemented concurrently on `fix/*` branches, in worktrees under `.claude/worktrees/`. They touch `control-plane-app.ts`, `serve.ts`, `mcp/server.ts`, `load-module.ts` and the workflows.
* **Open PRs:**
  * #77: roadmap and plan-status refresh. It overlaps NIW2-339.
  * #78: the MCP version and OpenAPI integer formats.
  * #55: the package-manager toggle, which is plan 12.
  * #56: the terminal request stream and keys, which is plan 13. Plans 12 and 13 are therefore not dead.
* **Cross-ticket interactions.**
  * NIW2-335 changes the editor -> core edge that NIW2-340 documents.
  * NIW2-334 may move core exports that NIW2-335 relies on.
  * NIW2-332 must share one stdout framing protocol with NIW2-310.

## Consolidated findings

The tickets hold the actionable detail. This section keeps the reviewers' conclusions in one place, including what they checked and found clean.

### Supply chain and contribution risk (Opus)

**For consumers: low to moderate risk.**

* Only `laqi` (apps/cli) is published. Every `@laqi/*` package is private and bundled.
* Installing runs no code: no install or prepare scripts exist in laqi or in any of its 41 transitive packages.
* The tarball holds `dist`, LICENSE and README: 50 files, about 718 kB.
* All 41 packages have valid registry signatures, and versions 2.0.0 to 2.1.0 carry SLSA provenance.
* At runtime, laqi binds to loopback by default, and the control plane is mounted only on loopback.
* **Real issues:**
  * `hono` is pinned at exactly 4.12.3, which is vulnerable (npm audit high, about 35 advisories; tracked in NIW2-312).
  * The install is 92 MB (NIW2-337).
  * Caret ranges on the other runtime dependencies.

**For the project: high risk.** Each item was verified via `gh api`:

* `main` has no protection and there are no rulesets.
* The `production` environment has no rules and holds `NPM_TOKEN`, `RELEASE_PLEASE_TOKEN` and the Cloudflare secrets.
* npm publishes with a long-lived token.
* Actions are pinned by tag.
* The default workflow token is `write`.
* Secret scanning, push protection, Dependabot and private vulnerability reporting are off.
* There is no CODEOWNERS and no SECURITY.md.
* Build and publish share one job.

**Already good:**

* `pull_request` is the only PR trigger; there is no `pull_request_target`.
* `head_ref` never reaches `run:`.
* `--frozen-lockfile` is used.
* The lockfile has no git or http sources.
* The dist-tag is validated.
* The tag/version cross-check and the `latest` guard exist.
* No bidi characters were found.

**Not verified:**

* the npm account 2FA mode;
* the scopes and expiry of the tokens and the PAT;
* the Cloudflare token scope.

### Application security (Sonnet)

**Nothing critical or high was found.**

**Medium:**

* Module-execution approval is not a human gate: the same caller can prepare and confirm. This is in NIW2-310.
* There is no Host-header check, so DNS rebinding can read GET routes, including the share token. This is in NIW2-309.

**Low:**

* JSON parse errors can leak a prefix of `.env` through the broad `schemaSources.root` (NIW2-313).
* The approval token uses `Math.random` (NIW2-310).
* There is a TOCTOU gap between the digest check and the import.
* `cors: '*'` is the default (documented).

**Checked and dropped:**

* eval and command injection (only two `spawn` calls, neither with a shell);
* SSRF in the server;
* path traversal (assets and the writer are confined, and symlinks are handled);
* prototype pollution;
* ReDoS;
* secrets in the tree;
* error leakage in Hono;
* rate-limiter exhaustion (buckets are capped).

**Not checkable offline:** dependency advisories. Run `bun audit` with network access.

### Code review (Sonnet)

Verified bugs: NIW2-332 (reproduced), NIW2-333, the lock race (NIW2-313) and silent OpenAPI `$ref` drops (NIW2-314).

Smaller items, already filed:

* `arrayLength` is uncapped over HTTP;
* there is no control-plane `onError`;
* `generate_data` ignores `from`;
* `resolveSourcePath` returns the unresolved path;
* a stale "Task 8" comment;
* the MCP version is hard-coded;
* `content-lint.ts` only recognises triple-backtick fences.

**Solid:**

* the prepare/confirm token lifecycle (single-use, TTL, bound to the digest);
* the revision and conflict model;
* atomic writes;
* the validation in `dist-tag.ts`;
* strict types;
* the stdio MCP end-to-end tests.

### Architecture (Sonnet)

**Graph:** schema -> core -> {server, generate} -> mcp, with the editor in the browser and `apps/cli` as the composition root. The graph is acyclic, has no cross-package relative imports, and Effect is confined to `generate` (ADR-0012 holds).

**Findings:**

* The bundle's dependency contract is maintained by hand (NIW2-336).
* Versions are pinned outside the catalog (NIW2-336).
* The editor relies on deep subpaths, and browser safety is not enforced (NIW2-335).
* `serve.ts` carries control-plane logic (NIW2-334).
* `core` is Node-bound, contrary to the ADR-0005/0007 edge assumption (NIW2-340).
* CI runs only on Bun (NIW2-336).
* The install is heavy (NIW2-337).
* Workspace package versions are unmanaged. This is harmless while the packages stay private.

**Docs versus code:** see NIW2-340.

### Design patterns (Sonnet)

**Patterns in use:**

* a layered package graph;
* a composition root;
* `Project` as a facade;
* `ProjectResult` as a result type;
* a ports-and-adapters `ControlPlaneRuntime`;
* factory functions;
* an observer `EventBus`;
* chain-of-responsibility layer resolution;
* Effect services inside generate.

**Violations:**

* The orchestration is duplicated between the CLI and MCP, and `startServer` is a god function (NIW2-334).
* The port is fat and half-typed (NIW2-334).
* The error vocabulary is duplicated (NIW2-334).
* The editor duplicates the precedence logic (NIW2-335).
* Each package handles errors in its own way (NIW2-334).
* The core barrel is too wide (NIW2-335).

**Suspected:** `Project` (577 lines) is a god class. Nobody has read it in full.

**Justified rather than over-engineered:**

* Effect inside generate;
* the public app and control-plane split.

### Documentation (Sonnet)

* **User-facing errors (NIW2-338):**
  * The docs claim the panel opens automatically.
  * They list 9 of the 15 MCP tools.
  * About 13 control-plane routes are missing.
  * The language count disagrees.
  * The layout and config sections are stale.
* **Internal site (NIW2-339):**
  * There are 16 merged plans, about 16.8k lines, that should be deleted.
  * Plan statuses contradict the code.
  * The roadmap is stale.
  * The docs README has the wrong port.
* **Verified correct:**
  * flags and defaults;
  * the layer names;
  * the `X-Laqi-*` headers;
  * the init scenarios;
  * `engines` and `bin`;
  * the release-process text.

## Housekeeping notes

* The `.claude/worktrees/agent-*` folders are excluded through `.git/info/exclude`. They belong to the concurrent NIW2-309 to 316 work, so remove them when that work lands.
* `workspace-temp/audits/` (gitignored) holds the first-pass per-package reports that NIW2-302 references.
