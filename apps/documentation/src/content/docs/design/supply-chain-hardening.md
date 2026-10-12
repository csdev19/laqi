---
title: Supply-chain hardening — design spec
---

# Supply-chain hardening — design spec

**Status:** proposed, not implemented.
**Date:** 2026-10-12.
**Ticket:** [NIW2-312](https://linear.app/niway/issue/NIW2-312) — Upgrade hono and harden the dependency and release pipeline. Part of the laqi audit, umbrella NIW2-302.
**Builds on:** [ADR-0010](/decisions/0010-release-and-npm/) (release-please, npm publishing), [ADR-0005](/decisions/0005-monorepo/) (Bun workspaces, catalog, tsdown bundling). Creates two ADRs: dependency version policy, release pipeline trust.

This document turns the audit findings on dependencies and the release pipeline into contracts an implementer can build and an owner can click through. Normative statements use **must** / **must not**. Code blocks marked _illustrative_ show intent, not final text.

Every "current behavior" line below was re-located in the read-only export of `origin/main` taken on 2026-10-12 (the branch the audit read was `feat/hero-demo`; nothing in this ticket's scope had changed on `main` since). GitHub and npm settings were read on the same date through the owner's `gh` account and the public registry; those reads are marked _verified_. Anything else is marked _unverified_.

## One-minute block

### Summary

The published `laqi` (2.1.0, `latest`) installs `hono@4.12.3` exactly, a version with 38 published advisories, two of them in the CORS middleware laqi mounts on every mock. It is the only package in laqi's 40-package production closure with any advisory, and the only one pinned exactly. The pin is why users have not received a fix in seven months: npm users never see `bun.lock`, so an exact pin in `package.json` gives them no integrity, only staleness.

The release pipeline publishes with a long-lived `NPM_TOKEN`, every action is addressed by a movable tag, `main` has no protection, the `production` environment has no rules, Dependabot is off, and a release is published after a build that runs no lint, type-check or tests. The fix is mechanical but ordered: bump and loosen the runtime dependencies, pin the actions, gate publishing behind `verify` on the tagged commit, switch npm to Trusted Publishing without losing a release, then lock the repository settings so the pipeline cannot be bypassed.

### Decisions

| #   | Decision                                                                                                                                                                                                                                                                                                              | Why                                                                                                                                                                                    | ADR                                                                |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| D1  | `hono` moves to `^4.13.13` (latest, 2026-10-04) in the catalog and in `apps/cli`; `bun.lock` resolves it to exactly 4.13.13.                                                                                                                                                                                          | 38 advisories at 4.12.3, 0 at 4.13.13 (GitHub Advisory DB, verified). No breaking-change section in 4.13.0; the two behaviour changes that touch laqi are harmless (below).            | none; range form follows the policy ADR                            |
| D2  | Runtime dependencies of the published CLI use caret ranges; `bun.lock` holds the tested version; exact pins are banned for `dependencies`. The catalog stores the same ranges.                                                                                                                                        | Consumers get no lockfile, so a pin cannot protect them and only freezes them. The lockfile plus Dependabot keep the version CI tests close to what users resolve.                     | ADR-0018 dependency version policy                                 |
| D3  | Runtime dependencies stay unbundled; only workspace packages and the already-bundled SDKs are folded in.                                                                                                                                                                                                              | `chokidar` needs its optional native `fsevents`; `typescript` (23 MB) is loaded lazily; bundling would turn every upstream patch into a laqi release.                                  | same ADR                                                           |
| D4  | Dependabot, not Renovate: ecosystems `bun` and `github-actions`, weekly, grouped minor+patch, default cooldown.                                                                                                                                                                                                       | Native to GitHub, no third-party app with write access to the repository, keeps the `# vX.Y.Z` comment next to SHAs. `catalog:` handling is unverified; a fallback trigger is defined. | same ADR                                                           |
| D5  | Every `uses:` is a full 40-hex commit SHA with a `# vX.Y.Z` comment; the repository setting "Require actions to be pinned to a full-length commit SHA" is turned on afterwards.                                                                                                                                       | A tag can be moved by whoever controls the action's repository; the publish job holds `id-token: write`.                                                                               | ADR-0019 release pipeline trust                                    |
| D6  | npm Trusted Publishing (OIDC) replaces `NPM_TOKEN`; the publish job runs on Node 24 (npm ≥ 11.5.1); after the first successful OIDC publish the package disallows tokens.                                                                                                                                             | A static token is a publish capability at rest; OIDC binds publishing to this repository, this workflow file and the `production` environment, and provenance comes for free.          | same ADR; supersedes the "Tokens" section of ADR-0010              |
| D7  | `release-npm.yml` and `deploy-site.yml` gain a `verify` job on the tagged SHA (`bun run verify`, `bun run audit`, pack-install smoke) that the publish/deploy job `needs:`.                                                                                                                                           | Today a release is built and published with no lint, type-check or tests on the tagged commit; the hub's release-gated-verification rule R1 says publishing is always gated.           | same ADR                                                           |
| D8  | `validate.yml` runs on `release-please--*` branches too; `Validate` becomes a required check on `main`.                                                                                                                                                                                                               | A skipped job cannot be a required check, and a branch name is attacker-choosable. The release PR is the candidate tier.                                                               | same ADR; contradicts the ADR-0010 addendum (see "Contradictions") |
| D9  | Production audit gate: `bun run audit` (`bun audit --prod --audit-level=moderate`) plus "pack the tarball, `npm install --omit=dev` it in an empty directory, `npm audit`, run `laqi --help`".                                                                                                                        | Audits what users install, not the monorepo's dev tree, with the resolver users have. Acceptance "no production advisory above low" is `--audit-level=moderate`.                       | none                                                               |
| D10 | `verify` covers every workspace: `@laqi/tokens` and `@laqi/documentation` get `check-types`; the root `tsconfig.json` is narrowed to root files and run by `check-types:root`.                                                                                                                                        | Today `tokens.test.ts`, `content.config.ts` and `vitest.config.ts` are type-checked by nobody.                                                                                         | none                                                               |
| D11 | Dev dependency refresh: `vitest` → 4.x, `oxfmt` → latest (drops `tinypool` 2.0.0), `sharp` → ^0.35.5, `@modelcontextprotocol/sdk` → ^1.32.1, `vite` ranges raised to patched floors.                                                                                                                                  | RCE-class advisories in tools contributors run; none ship. Astro 5 → 7 is a major migration and is deferred to its own ticket.                                                         | none                                                               |
| D12 | Repository settings: default `GITHUB_TOKEN` read-only; Dependabot alerts and security updates on; secret scanning and push protection on; rulesets on `main` and on `v*`/`site-v*` tags; `production` gets a required reviewer and a tag-only deployment policy; `RELEASE_PLEASE_TOKEN` moves to its own environment. | All verified off today. Without the tag ruleset anyone with push can trigger a publish; without the environment rule a stolen PAT publishes unattended.                                | release pipeline trust ADR                                         |

### Open questions for the owner

1. **Dependabot and `catalog:`.** GitHub documents Bun support for version updates only and says nothing about Bun catalogs. If the first Dependabot run leaves `hono`, `zod`, `typescript`, `tsdown`, `@types/bun` or `vitest` untouched because they are `catalog:` entries, do you accept switching to Renovate (Mend app, write access) or keeping Dependabot for everything else and bumping catalog entries by hand when the audit goes red? Recommendation: try Dependabot first; the catalog has six entries and the audit job is the real alarm.
2. **Required reviewer on `production`.** It adds one click per release and per site deploy, after merging the release PR. ADR-0010 made "merging the release PR" the act of releasing; this adds a second act. Recommendation: yes, because it is the only control that stops a stolen `RELEASE_PLEASE_TOKEN` from publishing to npm unattended. Say no if the click is unacceptable; the tag ruleset still blocks everyone who is not you.
3. **Vitest 4 or 5.** Vitest 4 keeps the Node 20 floor and Vite ≥ 6; Vitest 5 needs Node ≥ 22.12 and Vite ≥ 6.4 as a peer. Recommendation: 4.x now, 5 through a later Dependabot major PR.
4. **`oxfmt` 0.19 → 0.72.** Fifty minor versions of a formatter will reflow files; the cost is one `style:` commit before the gate, as ADR-0010 did once. Alternative: keep 0.19 and add a root `overrides` for `tinypool ^2.2.0`. Recommendation: upgrade; overrides on a formatter's internals rot.
5. **`audit` in `verify` or CI-only.** An audit needs the registry and can turn red without a code change. Recommendation: CI-only (validate, release gate, weekly schedule), with the mirror test carrying an explicit exemption list and the reason.
6. **Astro 5.18 → 7.x.** Ten advisories on 5.18.2 including a critical in AVIF image optimisation at build time, all on the repository's own images. Major migration of two Astro apps plus Starlight. Recommendation: separate ticket, dev-only.

### Out of scope

- Host/Origin/CSRF on the control plane, tunnel rate limits (NIW2-309); module execution approval (NIW2-310); anything inside `packages/*/src` beyond one new regression test file.
- Major upgrades of runtime dependencies that are not advisory-driven: `effect` 4 (see [ADR-0012](/decisions/0012-effect-first-in-generate/)), `chokidar` 5, `@hono/node-server` 2, `typescript` 6/7 (TypeScript 7 ships no stable programmatic API until 7.1 per published coverage; laqi uses the compiler API). Dependabot will propose them; each is its own PR.
- Astro 5 → 7 (open question 6).
- A `SECURITY.md` with a reporting channel is recommended but not part of the acceptance; it costs one file.
- SLSA levels beyond npm provenance, Sigstore verification by consumers, OpenSSF Scorecard automation.

## Current state on `main` (verified 2026-10-12)

| Finding                            | Where on `main`                                                                                                                                                                                                                      | Status vs audit                                                                                                                                   |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hono` pinned 4.12.3               | `apps/cli/package.json:48`, root `package.json:12` (catalog), `packages/server/package.json:16` (`catalog:`), `bun.lock` → `hono@4.12.3`. Published `laqi@2.1.0` declares `hono: 4.12.3` (registry, verified).                       | Unchanged.                                                                                                                                        |
| `zod`, `typescript` pinned exactly | `apps/cli/package.json:50-51`, catalog `package.json:13-14`. `examples/todo-app/package.json:25` pins `typescript` by hand instead of `catalog:`.                                                                                    | Unchanged.                                                                                                                                        |
| CORS middleware use                | `packages/server/src/mock-app.ts:10,97-103`: `cors({ origin: runtime.cors === '*' ? '*' : runtime.cors, allowHeaders: [4 names], exposeHeaders: [...] })`. No `credentials`, no `allowMethods`.                                      | Unchanged. See F1 for why neither CORS advisory is reachable through this configuration, and why the bump happens anyway.                         |
| SSE use                            | `packages/server/src/control-plane-app.ts:15,554-565`: `streamSSE`, `stream.writeSSE({ event: event.type, data: JSON.stringify(event) })`.                                                                                           | Unchanged. `data` is JSON-encoded (no raw CR/LF); `event` is an internal type name.                                                               |
| `NPM_TOKEN` publish                | `.github/workflows/release-npm.yml:90-95`.                                                                                                                                                                                           | Unchanged. `id-token: write` and `--provenance` are already there (lines 24, 93).                                                                 |
| Actions by tag                     | `deploy-site.yml:33,35,48`; `release-npm.yml:36,38,44`; `release-please.yml:27`; `validate.yml:27,29`. Unpinned tool: `validate.yml:71` `bunx --bun linkinator`.                                                                     | Unchanged.                                                                                                                                        |
| Release PRs skip validation        | `validate.yml:25` `if: ${{ !startsWith(github.head_ref, 'release-please--') }}`.                                                                                                                                                     | Unchanged.                                                                                                                                        |
| Publish without verification       | `release-npm.yml:49-53` installs and builds, then publishes. No lint, type-check or test on the tagged SHA. `deploy-site.yml:39-53` same.                                                                                            | Unchanged.                                                                                                                                        |
| `verify` coverage                  | root `package.json:28,32`; `turbo.json:6`; `packages/tokens/package.json` has no `check-types`; `apps/documentation/package.json` has none; root `tsconfig.json:3` includes `packages/*/src`, `apps/*/src`, `*.ts` and is never run. | Unchanged.                                                                                                                                        |
| GitHub: `main` protection          | `GET /repos/csdev19/laqi/branches/main/protection` → 404 "Branch not protected"; `GET /rulesets` → `[]`.                                                                                                                             | Verified as owner, so this is not a permissions artefact.                                                                                         |
| GitHub: `production` environment   | `protection_rules: []`, `deployment_branch_policy: null`. Secrets: `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `NPM_TOKEN`, `RELEASE_PLEASE_TOKEN`.                                                                             | Verified.                                                                                                                                         |
| GitHub: security features          | Dependabot alerts disabled; Dependabot security updates disabled; secret scanning and push protection disabled.                                                                                                                      | Verified.                                                                                                                                         |
| GitHub: Actions settings           | `allowed_actions: all`, `sha_pinning_required: false`, `default_workflow_permissions: write`, `can_approve_pull_request_reviews: true`.                                                                                              | Verified. The write default is worse than the audit assumed; every workflow does declare `permissions:` explicitly, which is what saves it today. |
| Dev-only advisories                | `bun.lock`: `vitest@2.1.9`, `tinypool@1.1.1` (vitest) and `@2.0.0` (`oxfmt@0.19.0`), `vite@5.4.21`, `sharp@0.34.5`/`0.35.2`, `undici@7.29.0`/`8.10.0`, `astro@5.18.2`, `js-yaml@4.3.1`, `@modelcontextprotocol/sdk@1.30.0`.          | Unchanged. Advisory status per package is in F6.                                                                                                  |
| Production closure                 | 40 packages reachable from the 8 runtime dependencies (computed from `bun.lock`). Queried one by one against the GitHub Advisory Database: only `hono@4.12.3` has advisories.                                                        | New evidence; the audit did not enumerate the closure.                                                                                            |

## F1 — `hono` 4.12.3 ships to every user

**Current behavior.** `apps/cli/package.json:48` declares `"hono": "4.12.3"`; the catalog mirrors it; `apps/cli/src/package.test.ts:43-51` enforces that the two stay byte-equal. The exact pin dates from 2026-02-26 (hono's publish date for 4.12.3). Fixes landed upstream from 4.12.4 (2026-03-03) onward; none reached users.

**Threat.** Any user of `npx laqi` runs a mock server with 38 known advisories. For laqi's own configuration:

- GHSA-88fw-hqm2-52qc (high, fixed 4.12.25): the CORS middleware reflects any `Origin` with `Access-Control-Allow-Credentials: true` when `credentials: true` is combined with a wildcard origin. laqi never sets `credentials`, so the credentialed branch is not taken. Not reachable today; one line in `mock-app.ts` away from being reachable.
- GHSA-8j4g-w8fx-2239 (moderate, fixed 4.12.34): quadratic backtracking on `Access-Control-Request-Headers` during preflight, only when `allowHeaders` is unset or empty. laqi passes four `allowHeaders`, so the vulnerable parse is skipped. Not reachable today; reachable the day someone makes `allowHeaders` configurable.
- GHSA-p6xx-57qc-3wxr (moderate, fixed 4.12.4): CR/LF injection in `writeSSE()` fields. laqi's `data` is `JSON.stringify` output and `event` is an internal type name, so no attacker-controlled raw newline reaches the writer. Not reachable today.
- The remaining 35 are in JSX, `serveStatic`, `toSSG`, cookies, JWT, Lambda adapters, `parseBody({dot:true})`, the language middleware, the cache middleware and the proxy helper: none imported (grep of `from 'hono…'`: `hono`, `hono/cors`, `hono/streaming`, `hono/utils/http-status` only).

The bump is still mandatory: a scanner cannot see "not reachable", every downstream team's `npm audit` goes red on `laqi`, and the reachability argument is one refactor away from false.

**Designed behavior.**

- `apps/cli/package.json` **must** declare `"hono": "^4.13.13"`; the catalog **must** hold the same string; `bun.lock` **must** resolve `hono` to 4.13.13 (`bun install` after the edit, `--frozen-lockfile` in CI).
- The published tarball's `dependencies.hono` **must** be a caret range whose floor has zero advisories in the GitHub Advisory Database at release time (the audit job in F5 enforces this mechanically).
- `packages/server/package.json` keeps `"hono": "catalog:"` (unchanged).

**What changes between 4.12.3 and 4.13.13 for laqi** (from the 4.13.0 release notes, verified; 4.13.1–4.13.13 notes not read individually, _unverified_):

- CORS: the default `Access-Control-Allow-Methods` now includes `QUERY`. laqi does not set `allowMethods`, so preflight responses will list one more method. Harmless for a mock server that already allows everything.
- RegExpRouter now throws `UnsupportedPathError` at registration instead of at first match. laqi builds `new Hono()` (`mock-app.ts:28`), which is `SmartRouter` over RegExpRouter and TrieRouter; `SmartRouter.match` runs `add()` inside the same `try` and `continue`s to the next router on `UnsupportedPathError` (source of `smart-router/router.ts` at v4.13.13, verified). Behaviour for user-supplied endpoint paths is unchanged. NIW2-315 owns the path grammar; this is informational for it.
- Performance-only changes to header and body handling; no API removals listed.
- `engines.node` is `>=16.9.0`; laqi's floor is `>=20`.

**Migration impact for npm users.** None visible. A fresh install resolves `hono` to the newest 4.x ≥ 4.13.13, which may be newer than the one CI tested; D2 accepts that and D4 keeps the gap to days. `laqi@2.1.0` users get the fix on their next `npx laqi` once the release that carries this lands (release-please will cut `2.1.1` from a `fix(deps):` commit).

**Tests.**

- `apps/cli/src/package.test.ts` › "pins no runtime dependency to an exact version": for every entry of `dependencies`, `expect(spec).toMatch(/^\^\d+\.\d+\.\d+$/)`. Input: the committed `apps/cli/package.json`. Expected: pass once D2 lands; fails today on `hono`, `typescript`, `zod`.
- `apps/cli/src/package.test.ts` › "keeps its ranges in step with the root catalog": the existing test's name and comment change from "pinned" to "ranges"; the assertion stays `toBe(spec)`.
- `apps/cli/src/package.test.ts` › "never floors hono below the first advisory-free patch line": parse the floor of `dependencies.hono` and assert `>= 4.13.13`, with a comment naming GHSA-88fw-hqm2-52qc and GHSA-8j4g-w8fx-2239. Guards against a careless revert of the range; Dependabot only moves it up.
- `packages/server/src/cors-advisories.test.ts` (new file, so it does not collide with NIW2-309's edits in `mock-app.test.ts`): (a) "a preflight with a pathological Access-Control-Request-Headers answers in bounded time": `OPTIONS /anything` with `Origin: http://a.test`, `Access-Control-Request-Method: GET`, `Access-Control-Request-Headers: ' '.repeat(50_000)`; expected 204 and wall time under 200 ms; (b) "never sends Access-Control-Allow-Credentials": same request; expected header absent. Both pass before and after the bump; they exist so the next refactor of `cors()` options trips them.

## F2 — Dependency version policy for a published CLI

**Current behavior.** Three runtime dependencies are exact (`hono`, `typescript`, `zod`), five are caret. The catalog stores exact strings for the three and ranges for the rest, with `vitest: "^2.1.0"` duplicated in root `devDependencies` (root `package.json:17,43`). `examples/todo-app` pins `typescript` by literal instead of `catalog:`.

**Failure scenario.** Exactly F1: a security patch upstream, nobody notices, users stay on the vulnerable version until laqi's next release. The exact pin was meant to make installs reproducible; for npm consumers it does not, because `bun.lock` is not in the tarball and transitive dependencies of `hono`, `effect`, `quicktype-core` are already ranges.

**Designed behavior** (the policy; the "why not" is in the ADR).

- Every entry of `apps/cli/package.json#dependencies` **must** be a caret range `^MAJOR.MINOR.PATCH` where the floor is the version `bun.lock` resolves. Exact pins and `~` ranges **must not** appear there.
- The catalog **must** hold the same range string for every package it shares with `apps/cli` (`hono`, `zod`, `typescript`); the existing equality test enforces it. Workspace packages keep `catalog:`.
- `bun.lock` is the tested version; CI installs with `--frozen-lockfile` (unchanged). The lockfile **must** be committed in the same PR as any range change.
- A major bump of a runtime dependency **must** be its own PR with a changelog entry (`fix(deps)!:` or `feat(deps):` by effect on users), never grouped.
- `examples/todo-app/package.json` **must** reference `typescript` through `catalog:`.
- The root `devDependencies.vitest` **must** be `catalog:`, so the catalog is the single source.

**Interfaces** (_illustrative_, `apps/cli/package.json` after D1–D2):

```json
"dependencies": {
  "@faker-js/faker": "^10.6.0",
  "@hono/node-server": "^1.19.7",
  "chokidar": "^4.0.3",
  "effect": "^3.22.1",
  "hono": "^4.13.13",
  "quicktype-core": "^26.0.0",
  "typescript": "^5.9.3",
  "zod": "^4.3.6"
}
```

`zod` stays at floor `^4.3.6` in this ticket; the lockfile may move it with Dependabot afterwards. Reason: `packages/schema` error messages and `packages/generate` goldens are sensitive to Zod minors, and this ticket should not own a golden refresh. (`zod@4.3.6` and `zod@4.6.6` both have zero advisories, verified.)

**Migration impact.** None for users. For the repository: `bun install` rewrites `bun.lock` ranges; `apps/cli/src/package.test.ts` wording changes.

**Tests.** As in F1 plus `apps/cli/src/package.test.ts` › "the example app takes typescript from the catalog" (`examples/todo-app` devDependencies.typescript === `'catalog:'`) and › "the root takes vitest from the catalog".

## F3 — Actions addressed by movable tags

**Current behavior.** Eleven `uses:` lines across four workflows, all `@vN`. The publish job (`release-npm.yml`) holds `id-token: write` and, today, `NPM_TOKEN`; the deploy job holds `CLOUDFLARE_API_TOKEN`; the release-please job holds a PAT with Contents and Pull-requests write.

**Threat.** A moved tag on `actions/checkout`, `oven-sh/setup-bun`, `actions/setup-node`, `googleapis/release-please-action` or `cloudflare/wrangler-action` runs attacker code with those credentials. With OIDC (F4) the prize becomes "publish anything as `laqi`" for the duration of one job. GitHub's own hardening guide calls a full-length SHA "the only way to use an action as an immutable release".

**Designed behavior.**

- Every `uses:` in `.github/workflows/*.yml` **must** be `owner/repo@<40 hex> # vX.Y.Z`. The comment **must** name the release the SHA was taken from; Dependabot keeps both in step.
- The SHA **must** be resolved from the action's own repository (`gh api repos/<owner>/<repo>/git/ref/tags/<tag>`, dereferencing annotated tags), never copied from a third-party listing.
- `bunx --bun linkinator` **must** become `bun run check:site` with `linkinator` invoked from the lockfile (`bun x linkinator` resolves the installed devDependency; _unverified_ whether `bunx` prefers the local binary when present, so the script **must** call `./node_modules/.bin/linkinator` explicitly or `bun run --bun linkinator`).
- After the pins land, the repository setting `sha_pinning_required` **must** be `true` (owner checklist step A4). Order matters: enabling it first fails every existing workflow.

**SHAs resolved on 2026-10-12** (from each action's own repository; re-resolve at implementation time):

| Action                             | Release | Commit                                     | Note                                                                                                                                                                                                                          |
| ---------------------------------- | ------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `actions/checkout`                 | v7.0.1  | `3d3c42e5aac5ba805825da76410c181273ba90b1` | v5 moved to the Node 24 runtime; v6 persists credentials in a separate file; v7 blocks checking out fork PRs on `pull_request_target` (laqi has none). No input laqi uses changed.                                            |
| `actions/setup-node`               | v7.1.0  | `949feb2413d6458794dcd2491c4babbbce0c15c1` | v5 added automatic caching when `packageManager` is set (laqi's is `bun@1.3.4`); pass `package-manager-cache: false`. v7 removed the dummy `NODE_AUTH_TOKEN` export, which is what makes OIDC work without a token (F4).      |
| `oven-sh/setup-bun`                | v2.2.0  | `0c5077e51419868618aeaa5fe8019c62421857d6` | Same major as today.                                                                                                                                                                                                          |
| `googleapis/release-please-action` | v5.0.0  | `45996ed1f6d02564a971a2fa1b5860e934307cf7` | Only breaking change: Node 24 runtime. Inputs unchanged.                                                                                                                                                                      |
| `cloudflare/wrangler-action`       | v4.1.3  | `953926a2e2182532811c01a25e53647d93bf07c0` | v4 installs Wrangler 4 by default; `apps/site` already uses `wrangler ^4.128.0`. Pass `wranglerVersion` from the lockfile or rely on the action's package-manager detection (_unverified_ which one wins; set it explicitly). |

**Migration impact.** None for users. Runners: Node 24 runtime actions need runner ≥ 2.327.1; GitHub-hosted runners satisfy this.

**Tests** (`scripts/release/workflows.test.ts`, extending the existing suite):

- "pins every action to a full commit SHA with a version comment": for every `uses:` line in every workflow, `expect(line).toMatch(/uses: [\w.-]+\/[\w.-]+(\/[\w.-]+)?@[0-9a-f]{40} # v\d+\.\d+\.\d+/)`. Also fails on `docker://` and on local `./` actions (none exist; the pattern excludes them on purpose so a new one is a conscious choice).
- "never runs a tool through an unpinned bunx": no `run:` block matches `/\bbunx\b/` unless followed by `@<version>`.

## F4 — Long-lived `NPM_TOKEN` and the retirement of tokens

**Current behavior.** `release-npm.yml:90-95` publishes with `NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}` from the `production` environment, which has no protection rules. `permissions.id-token: write` and `--provenance` are set and `laqi@2.1.0` carries a SLSA v1 provenance attestation (registry, verified). The job runs `actions/setup-node@v4` with `node-version: 22`, which ships npm 10.9.x.

**Threat.** The token is a bearer capability: anyone who reads it (a compromised action, a log leak, a laptop with the secret cached) publishes `laqi` to `latest` for every team that runs `npx laqi`. Provenance does not stop that; it only records which workflow produced the tarball.

**Designed behavior.**

- Publishing **must** authenticate through npm Trusted Publishing: a GitHub Actions publisher bound to owner `csdev19`, repository `laqi`, workflow filename `release-npm.yml`, environment `production`.
- The publish job **must** run `actions/setup-node` (pinned) with `node-version: 24` and `registry-url: https://registry.npmjs.org`, and **must not** set `NODE_AUTH_TOKEN` at all (empty string included). Node 24.5.0+ bundles npm ≥ 11.5.1 (Node release index, verified: latest 24.21.0 ships npm 11.19.0); trusted publishing requires npm ≥ 11.5.1 and Node ≥ 22.14.
- `npm publish --provenance --access public --tag …` stays. Provenance is automatic under OIDC; the flag is harmless and keeps the token-era behaviour documented. (_Unverified_: one community report claims `--provenance` is needed to enter the OIDC path on some npm versions; keeping it costs nothing.)
- `permissions.id-token: write` **must** be scoped to the publish job, not the workflow (the new `verify` job does not need it).
- After the first OIDC publish succeeds, the package setting "Require two-factor authentication and disallow tokens" **must** be on, the granular token **must** be revoked on npmjs.com, and the `NPM_TOKEN` secret **must** be deleted.
- `scripts/release/workflows.test.ts` **must** fail if any workflow references `secrets.NPM_TOKEN` or sets `NODE_AUTH_TOKEN`.

**Cut-over without breaking a release** is the ordered checklist in "Owner-side checklist", steps B6–B10. The invariant: at every moment one working publish path exists. The token path keeps working while the trusted publisher is configured (npm accepts either); the workflow switches to OIDC in one PR; the first release after that PR proves OIDC; only then are tokens disallowed. If the first OIDC publish fails after the tag was cut, the recovery is: fix the publisher configuration on npmjs.com (E404 means the owner/repo/workflow/environment tuple did not match) and re-run the failed job from the Actions UI — a re-run uses the same workflow file and the same tagged SHA, so no new tag is needed. If the workflow file itself is wrong, publish that one tagged version from a clean checkout of the tag with the still-valid granular token (`npm publish --access public`, no provenance, one-time), then fix forward on `main`.

**Interfaces** (_illustrative_, `release-npm.yml` after F3, F4, F5):

```yaml
name: Publish to npm 📦
on:
  push: { tags: ['v*'] }
  workflow_dispatch:
    inputs:
      dry_run: { description: 'Build and pack, but do not publish', type: boolean, default: true }

permissions:
  contents: read

concurrency:
  group: publish-${{ github.ref }}
  cancel-in-progress: false

jobs:
  verify:
    name: Verify the tagged commit
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
      - uses: oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2.2.0
        with: { bun-version: 1.3.4 }
      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0
        with: { node-version: 24, package-manager-cache: false }
      - run: bun install --frozen-lockfile
      - run: bun run verify          # lint, format check, build, every type-check, tests
      - run: bun run audit           # bun audit --prod --audit-level=moderate
      - name: Install the tarball the way a user does, and run it
        run: bun scripts/release/consumer-smoke.ts   # F5: pack, npm install --omit=dev, npm audit, laqi --help

  publish:
    name: Publish
    needs: verify
    runs-on: ubuntu-latest
    environment: production
    permissions:
      contents: read
      id-token: write                # OIDC exchange with npm, and provenance
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
      - uses: oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2.2.0
        with: { bun-version: 1.3.4 }
      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0
        with:
          node-version: 24           # npm >= 11.5.1: trusted publishing needs it
          registry-url: https://registry.npmjs.org
          package-manager-cache: false
      - run: bun install --frozen-lockfile
      - run: bun run build
      - name: Resolve version and dist-tag
        id: meta
        run: … unchanged …
      - run: npm pack --dry-run
        working-directory: apps/cli
      - name: Publish
        if: ${{ github.event_name == 'push' || inputs.dry_run == false }}
        working-directory: apps/cli
        run: npm publish --provenance --access public --tag "${{ steps.meta.outputs.dist_tag }}"
        # No NODE_AUTH_TOKEN: npm exchanges this job's OIDC token with npmjs.com.
```

The `publish` job rebuilds rather than downloading `verify`'s artifact: same SHA, same lockfile, same Bun; the hub's R1 asks for verification on the same SHA, not for artifact hand-off. Reopen if a build ever proves non-deterministic.

**Migration impact.** None for users. Provenance attestations continue; the `_npmUser` on the registry stays `csdev19` (publishes through a trusted publisher are attributed to the configuring account, _unverified_).

**Tests** (`scripts/release/workflows.test.ts`):

- "never publishes with a token": no workflow mentions `secrets.NPM_TOKEN`; no step in `release-npm.yml` has `env.NODE_AUTH_TOKEN`.
- "publishes only behind a verify job": in `release-npm.yml` and `deploy-site.yml`, the job whose steps run `npm publish` / `wrangler-action` has `needs:` containing a job that runs `bun run verify` and `bun run audit`.
- "grants id-token only to the publishing job": workflow-level `permissions` has no `id-token`; the `publish` job has `id-token: write`; no other job does.
- "publishes from a Node that carries npm 11.5.1 or newer": the publish job's `setup-node` step has `node-version` ≥ 24.
- "keeps the production environment on the jobs that publish or deploy, and nowhere else": `release-please.yml`'s job uses a different environment (F7).

## F5 — Publishing without verification, release PRs without validation, no audit gate

**Current behavior.** `release-npm.yml` runs install → build → publish. `deploy-site.yml` runs install → build site → deploy. `validate.yml:25` skips release PRs. Nothing in CI runs `bun audit`. The hub's normative page [release-gated-verification](https://github.com/csdev19/general-knowledge/blob/main/monorepos/release-gated-verification.md) (local: `~/Documents/Workspace/Personal/general-knowledge/monorepos/release-gated-verification.md`) rules R1 ("publishing is gated, always") and R2 ("one definition of verified") are both violated.

**Failure scenario.** A release PR is merged after a commit that broke a test on `main` (nothing ran on the release PR); the tag triggers build and publish; users get a broken `laqi`. Or: a transitive dependency acquires an advisory; nobody notices until a downstream team's audit fails.

**Designed behavior.**

- `release-npm.yml` and `deploy-site.yml` **must** have a `verify` job that runs `bun run verify` and `bun run audit` on the checked-out tag, and the publishing/deploying job **must** `needs:` it.
- `validate.yml` **must not** carry the `release-please--*` skip. The release PR is the candidate tier: it is the last run before a tag exists, and `Validate` must report on it to be a required check.
- Root `package.json` **must** gain `"audit": "bun audit --prod --audit-level=moderate"`. _Unverified_: that Bun 1.3.4 accepts `--prod` (documented in current Bun docs; the flag's introduction version was not checked) and that `--prod` at a workspace root walks workspace `dependencies` rather than the root's (empty) ones. The rollout step R2 checks both; if either fails, bump `packageManager`/`bun-version` or run the script from `apps/cli`.
- A new `scripts/release/consumer-smoke.ts` **must** pack `apps/cli`, `npm install --omit=dev --ignore-scripts --no-fund` the tarball into an empty temporary directory, run `npm audit --omit=dev --audit-level=moderate` there, and execute `node_modules/.bin/laqi --help` expecting exit 0. This is the only check that uses npm's resolver on the ranges users see. It **must** run in `validate.yml`, in both release `verify` jobs, and on a weekly schedule.
- `.github/workflows/audit.yml` (new) **must** run `bun run audit` and the consumer smoke on `schedule: cron: '0 6 * * 1'` and `workflow_dispatch`, with `permissions: contents: read`. It is the alarm for advisories that appear without a commit.
- `scripts/release/workflows.test.ts` › "local verification mirrors CI" **must** gain an explicit exemption list `CI_ONLY = ['audit']` with the reason ("needs the registry; can turn red without a change") so the mirror invariant stays honest instead of being weakened silently.

**Interfaces** (_illustrative_, `scripts/release/consumer-smoke.ts`):

```ts
#!/usr/bin/env bun
// What a user gets: pack the CLI, install the tarball with npm (their
// resolver, their ranges, no bun.lock), audit it, run it.
import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const cli = join(import.meta.dirname, '..', '..', 'apps', 'cli')
const work = mkdtempSync(join(tmpdir(), 'laqi-consumer-'))
const tarball = execFileSync('npm', ['pack', '--pack-destination', work, '--silent'], { cwd: cli, encoding: 'utf8' }).trim()
execFileSync('npm', ['init', '-y'], { cwd: work, stdio: 'ignore' })
execFileSync('npm', ['install', '--omit=dev', '--ignore-scripts', '--no-fund', join(work, tarball)], { cwd: work, stdio: 'inherit' })
execFileSync('npm', ['audit', '--omit=dev', '--audit-level=moderate'], { cwd: work, stdio: 'inherit' })
execFileSync(join(work, 'node_modules', '.bin', 'laqi'), ['--help'], { cwd: work, stdio: 'inherit' })
```

**Cost** (hub R6): `Validate` now also runs on each release-PR update, i.e. once more per merge to `main`, roughly 4–6 minutes on a Linux runner; the two release gates add one `verify` run per release. The weekly audit is one short job. All on a public repository's free minutes; R3 (spending limit and alerts) is step A5 of the checklist.

**Migration impact.** None for users. For the owner: a release PR now shows a `Validate` check and merges only when green.

**Tests.** The workflow assertions in F4 plus:

- `scripts/release/workflows.test.ts` › "validates release PRs": `validate.yml`'s job has no `if:` mentioning `release-please`.
- › "audits on a schedule": `audit.yml` exists, has `on.schedule`, runs `bun run audit` and `scripts/release/consumer-smoke.ts`, and declares no secrets.
- `scripts/release/consumer-smoke.test.ts` › "fails when the installed binary does not run": unit-test the script's steps by injecting a fake `execFileSync` (the script exports a `run(exec)` function; the shebang entry calls it with the real one). Inputs: an exec that throws on `--help`; expected: the script rejects with the step name.

## F6 — Dev-only vulnerable dependencies

**Current behavior and advisory status** (GitHub Advisory DB, verified 2026-10-12; none of these ship in the tarball — `bun.lock` closure computed, and `dist/*.mjs` was confirmed free of the MCP SDK's HTTP transport by the security scan):

| Package                     | Locked          | Advisories                                                                                | Patched in      | Pulled in by                                 | Action                                                                                        |
| --------------------------- | --------------- | ----------------------------------------------------------------------------------------- | --------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `vitest`                    | 2.1.9           | GHSA-5xrq-8626-4rwp critical (UI server file read/exec, `--ui` only), GHSA-82fw-gwwq-j7x9 | 4.1.11 (both)   | root, `@laqi/tokens` (catalog `^2.1.0`)      | catalog `vitest: ^4.1.11`; see migration notes below                                          |
| `tinypool`                  | 1.1.1 / 2.0.0   | GHSA-5gmw-xhrv-c9v3, GHSA-85c8-ppgw-ccpr (critical, prototype-pollution to RCE)           | 2.1.2           | `vitest@2` / `oxfmt@0.19.0`                  | Vitest 4 drops Tinypool; `oxfmt` latest (0.72.0) depends on `tinypool 2.2.0`                  |
| `vite`                      | 5.4.21          | GHSA-fx2h-pf6j-xcff high (Windows `fs.deny` bypass), two moderate                         | 6.4.3 / 7.3.5   | `vitest@2` (vite-node)                       | Gone with Vitest 4. `packages/editor` `^6.0.7` → `^6.4.3`; example `^7.0.0` → `^7.3.5`        |
| `sharp`                     | 0.34.5 / 0.35.2 | three high (libvips, libheif, librsvg)                                                    | 0.35.5          | `apps/site`, `apps/documentation`, miniflare | `^0.35.5` in both apps; root `overrides` for the miniflare copy if Dependabot cannot reach it |
| `undici`                    | 7.29.0 / 8.10.0 | two high, several moderate                                                                | 7.29.1 / 8.10.2 | linkinator, miniflare (wrangler), astro      | `wrangler ^4.149.0`, `linkinator` latest; Astro's copy waits for open question 6              |
| `astro`                     | 5.18.2          | ten, one critical (AVIF optimisation RCE at build time, repository's own images)          | 7.2.8           | both Astro apps                              | Separate ticket (open question 6)                                                             |
| `js-yaml`                   | 4.3.1           | GHSA-2883-xcg3-v3hh high                                                                  | 4.3.2           | dev tooling (not in the production closure)  | Dependabot patch PR                                                                           |
| `proxy-addr`                | 2.0.7           | GHSA-jqcg-44mw-7w3h critical                                                              | 2.0.8           | `@modelcontextprotocol/sdk` → express        | Not shipped (tree-shaken); fixed by the SDK bump                                              |
| `@modelcontextprotocol/sdk` | 1.30.0          | GHSA-6qxp-vccf-f47h high (OAuth client; laqi uses stdio only)                             | 1.31.0          | `apps/cli` devDeps, `packages/mcp`           | `^1.32.1` (latest); NIW2-314 owns the SDK's usage, this ticket owns the version string        |

**Vitest 2 → 4 migration notes** (from the v3 and v4 migration guides, verified): `spy.mockReset` restores the original implementation (v3); stricter error equality in `toEqual`/`toThrowError` (v3); fake timers mock every timer API unless `toFake` is set (v3); `workspace` → `projects`, `poolOptions` removed, default `exclude` reduced to `node_modules` and `.git`, reporter API changes, `coverage.all` removed (v4). `vitest.config.ts` on `main` uses none of the removed options (`include`, `environment`, `testTimeout`, `hookTimeout` only). Seventeen test files opt into jsdom with `@vitest-environment jsdom`; the jsdom environment still exists in v4 (_unverified_ for the exact `jsdom@25` pairing; run the suite). Tests that rely on `vi.restoreAllMocks` resetting plain `vi.fn()` spies would change behaviour; grep at implementation time.

**Designed behavior.**

- The catalog **must** carry `vitest: ^4.1.11` and every workspace that lists vitest **must** use `catalog:`.
- `oxfmt` **must** move to a version whose `tinypool` dependency is ≥ 2.1.2 (0.72.0 → 2.2.0, verified); `oxlint` **must** move with it to keep the pair in step. The resulting reflow lands as one `style:` commit, as ADR-0010's addendum did.
- `sharp` **must** be `^0.35.5` in `apps/site` and `apps/documentation`.
- `vite` floors **must** be raised as in the table.
- After the refresh, `bun audit` (no `--prod`) **should** report nothing at high or above outside Astro; Astro's advisories are accepted until open question 6 is resolved and **must** be listed in the PR description.

**Migration impact.** None for users. Contributors: run `bun install` once; `oxfmt` reflow may touch many files.

**Tests.** The existing suite is the test. Additionally `scripts/release/workflows.test.ts` › "takes vitest from the catalog everywhere": every workspace `package.json` that mentions `vitest` uses `catalog:`.

## F7 — Repository settings and environments

**Current behavior.** Verified above: no branch protection or rulesets; `production` without reviewers or deployment policy; `release-please.yml` uses `production` on every push to `main` because the PAT lives there; Actions default token `write`; SHA pinning not required; Dependabot and secret scanning off.

**Threat.** Anyone with push can create a `v*` tag and publish (after F4: publish through OIDC, which trusts the workflow, not the person). A stolen `RELEASE_PLEASE_TOKEN` pushes a tag and the publish runs unattended. A PR can be merged red.

**Designed behavior** (settings are owner actions; the exact clicks are in the checklist):

- Ruleset `main`: target the default branch; restrict deletions; block force pushes; require a pull request (0 required approvals — a solo owner cannot approve their own PR); require status check `Validate` (the job `name` in `validate.yml`), strict mode off; bypass list empty.
- Ruleset `release tags`: target `refs/tags/v*` and `refs/tags/site-v*`; restrict creations, updates and deletions; bypass list: Repository admin. release-please creates tags through the PAT as `csdev19`, an admin, so the bypass is what lets releases happen (_unverified_ that rulesets treat a fine-grained PAT exactly as its user for bypass purposes; the first release after the ruleset proves it, and a blocked tag creation fails loudly in the release-please run rather than silently).
- Environment `release-please` (new): holds `RELEASE_PLEASE_TOKEN`; no reviewers; deployment branches: `main` only. `release-please.yml` **must** declare `environment: release-please`.
- Environment `production`: holds `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` (and `NPM_TOKEN` until B10); required reviewer `csdev19`, "prevent self-review" off; deployment branches and tags: `v*`, `site-v*`, and `main` (for the dry-run dispatch). Open question 2 decides the reviewer.
- Actions: default workflow permissions `read`; "allow GitHub Actions to create and approve pull requests" off; `sha_pinning_required` on after F3 lands.
- Code security: dependency graph on; Dependabot alerts on; Dependabot security updates on (effective for `github-actions`; GitHub documents no security updates for `bun`); secret scanning and push protection on.
- `.github/dependabot.yml` (new):

```yaml
# illustrative
version: 2
updates:
  - package-ecosystem: bun            # bun.lock at the root covers every workspace
    directory: /
    schedule: { interval: weekly, day: monday }
    open-pull-requests-limit: 10
    groups:
      minor-and-patch:
        patterns: ['*']
        update-types: [minor, patch]  # majors arrive one PR each
    commit-message: { prefix: 'fix(deps)', prefix-development: 'chore(deps)' }
  - package-ecosystem: github-actions
    directory: /
    schedule: { interval: weekly, day: monday }
    groups:
      actions: { patterns: ['*'] }
    commit-message: { prefix: 'ci(deps)' }
```

`prefix-development` is listed for `npm` in GitHub's docs; whether Dependabot applies it to `bun` is _unverified_. Conventional-commit prefixes matter here: `fix(deps)` cuts a patch release of `laqi` (which is the point for runtime dependencies), `chore`/`ci` are hidden from the changelog. If `prefix-development` is ignored, every Dependabot PR will be `fix(deps)` and dev-only bumps will cut releases; the fallback is to retitle before squash-merging, or to split the Bun entry into two with `allow: dependency-type` (also _unverified_ for Bun). Default cooldown (3 days) stays; security fixes for runtime dependencies are driven by the audit job, not by cooldown.

**Tests.** `scripts/release/dependabot.test.ts` (new): parses `.github/dependabot.yml`; expects ecosystems exactly `{bun, github-actions}`, both at `directory: /`, both weekly; the bun entry has a group restricted to `minor, patch`. Settings themselves are not testable from the repository; the checklist is their test, and a weekly `gh api` read could be added to `audit.yml` later (not in scope).

## Contradictions with existing records

- **ADR-0010, "Tokens" section** records `NPM_TOKEN` in `production`. D6 removes it. ADR-0010 has no reopen condition; its "Costs" paragraph ("two manually created tokens that expire and will one day fail a publish with `E401`") is the motivation. The release-pipeline-trust ADR supersedes that section and only that section; the version topology, dist-tag rule and two-workflow split stand.
- **ADR-0010 addendum and the playbook's step 6** skip validation on `release-please--*`. D8 reverses it. The hub's normative page (release-gated-verification, R1 and the tier table) names the release PR as the candidate tier that runs `verify`; the playbook predates it. The spec follows the normative page and says so.
- **ADR-0005** "The CLI published to npm doesn't drag in the editor's or the documentation's dependencies" stands; D3 keeps runtime dependencies unbundled, which ADR-0005's tsdown comment already states.

## Alternatives considered and rejected

- **Keep exact pins for runtime dependencies.** Strongest argument: a user's install is byte-identical to what CI tested. Rejected: it is not — transitive dependencies are ranges and there is no consumer lockfile — and the cost is what F1 shows: seven months on a version with 38 advisories.
- **Bundle every runtime dependency into `dist/`.** Strongest argument: zero install-time variance, faster `npx`, no `npm audit` noise for consumers. Rejected: `chokidar`'s optional native `fsevents` cannot be bundled; `typescript` is 23 MB and loaded lazily by design (`package.test.ts` "lazy loading"); every upstream patch would require a laqi release, and the attribution/licence surface of the tarball grows. Reopen if a bundled-everything build proves to be smaller than the install it replaces.
- **Renovate instead of Dependabot.** Strongest argument: explicit catalog support in its npm manager, `pinDigests` for actions, lockfile maintenance, better grouping. Rejected for now: it is a third-party GitHub App with write access, which is one more thing this ticket exists to remove; Dependabot is native and keeps the version comment next to SHAs. Reopen condition in the ADR: Dependabot leaves `catalog:` entries untouched after two weekly runs.
- **Keep the token but rotate it and require 2FA.** Strongest argument: proven path, no cut-over risk. Rejected: rotation does not change the trust model; a token at rest is still a publish capability, and npm now offers a binding to the workflow file.
- **Gate job pattern (hub `pr-checks`) instead of running `Validate` on release PRs.** Strongest argument: saves one run per merge. Rejected: the release PR is exactly where the last verification before a tag should run; the saving is minutes on a public repository.
- **`bun audit` alone as the production gate.** Strongest argument: one command, already in Bun. Rejected as the only gate: it audits Bun's resolution of `bun.lock`, not npm's resolution of the published ranges; the consumer smoke uses the resolver users have. `bun audit --prod` stays as the fast local check.
- **Download the verified build artifact into the publish job.** Strongest argument: publish exactly the bytes that were verified. Rejected for now: same SHA, same lockfile, same toolchain; the hub asks for verification on the same SHA. Reopen if a build is ever shown to be non-deterministic.
- **`typescript` as an optional peer dependency.** Strongest argument: 23 MB less per install for users who never paste TypeScript models. Rejected here: `npx laqi` must work with no extra step, and the generation stack is lazily loaded already. Candidate for its own ticket.
- **Hard-fail the build on any dev-dependency advisory.** Rejected: dev advisories (Astro's AVIF path, Vitest's `--ui`) do not reach users and would block releases on tooling noise; the production gate is strict, the dev audit is informational.

## Cross-ticket dependencies and file boundaries

Files this ticket owns: root `package.json`, `bun.lock`, `.github/**`, `scripts/release/**` (new tests and `consumer-smoke.ts`), `apps/cli/package.json` (dependency fields only), `packages/tokens/package.json` and a new `packages/tokens/tsconfig.json`, `apps/documentation/package.json`, root `tsconfig.json`, the "Setup, once" section of `README.md`, this spec and its ADRs. One new test file `packages/server/src/cors-advisories.test.ts`.

| Ticket   | Touch point                                                                                                                    | Rule                                                                                                                                            |
| -------- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| NIW2-309 | Owns `packages/server/src/*` including `mock-app.ts`. The hono bump changes behaviour it tests (CORS preflight lists `QUERY`). | This ticket adds only `cors-advisories.test.ts`; 309 must not pin or change the `hono` range. Land D1 first so 309's tests run against 4.13.13. |
| NIW2-314 | Owns MCP tool code; the SDK version bump is a devDependency string in `apps/cli/package.json` and `packages/mcp/package.json`. | This ticket bumps the string; 314 adapts code if 1.32 changes an API it uses.                                                                   |
| NIW2-315 | Endpoint path grammar; hono 4.13's registration-time `UnsupportedPathError` is contained by `SmartRouter`.                     | Informational; no file overlap.                                                                                                                 |
| NIW2-316 | `packages/editor` (vite floor), `apps/site` (sharp, wrangler).                                                                 | This ticket changes only version strings in those `package.json` files; 316 owns everything else there.                                         |
| All      | `bun.lock`.                                                                                                                    | Every ticket re-runs `bun install` after rebasing; never resolve a lockfile conflict by hand.                                                   |

## Rollout, in order

Each step is one PR or one owner action; each leaves a working publish path.

- **A (owner, no PR).** Settings that break nothing: dependency graph, Dependabot alerts, Dependabot security updates, secret scanning, push protection, default workflow permissions read-only, Actions spending limit and alerts.
- **R1 — `fix(deps): move hono to 4.13.13 and loosen runtime ranges`.** D1, D2; `package.test.ts` changes; `cors-advisories.test.ts`; `examples/todo-app` and root `vitest` to `catalog:`. Merge, merge the release PR it produces (`2.1.1`). Users are fixed here; everything after is pipeline work.
- **R2 — `ci: pin actions, verify before publishing, validate release PRs, audit what ships`.** F3, F5, F7's `dependabot.yml`, `audit.yml`, `consumer-smoke.ts`, root `audit` script, workflow tests. Still publishes with the token. Prove with a `workflow_dispatch` dry run. After merge: owner step A4 (`sha_pinning_required`), then watch the first Dependabot run for `catalog:` handling (open question 1).
- **B6–B7 (owner).** Configure the npm trusted publisher. Nothing changes yet.
- **R3 — `ci: publish through npm trusted publishing`.** F4: Node 24, `setup-node` v7 SHA, no `NODE_AUTH_TOKEN`, `id-token` scoped to the publish job. Dry run again (it cannot exercise the OIDC exchange; it proves everything else).
- **Next release.** The first OIDC publish. On success → B10 (revoke token, delete secret, disallow tokens). On failure → recovery in F4.
- **R4 — `ci: give release-please its own environment`.** Owner creates `release-please` environment with the PAT, PR changes `release-please.yml`, owner deletes the PAT from `production`, then sets the reviewer and deployment policy on `production` and creates the two rulesets. Order matters: a reviewer on `production` before R4 blocks every push to `main` behind an approval.
- **R5 — `chore: make verify cover every workspace`.** D10: `packages/tokens` `check-types` + `tsconfig.json`; `apps/documentation` `check-types: astro check` with `@astrojs/check` and `typescript: catalog:` in devDependencies; root `tsconfig.json` narrowed to `include: ["*.ts"]` with `types: ["node"]`; root script `check-types:root` added to `verify`; mirror test updated.
- **R6 — `chore(deps): refresh dev tooling`.** D11 in two commits: `style:` for the `oxfmt` reflow, then the version bumps. Astro stays (open question 6).
- **R7 — docs.** ADR numbers assigned, ADR index row added, ADR-0010 marked "Tokens section superseded by ADR-0019", README "Setup, once" rewritten (no `NPM_TOKEN`; two environments), this spec's status updated.

## Owner-side checklist (exact steps, in order)

Everything below is a manual action on npmjs.com or github.com, or one `gh api` call. Do them in this order; the letter groups match the rollout above.

**A. Repository settings that break nothing (do first)**

1. github.com → `csdev19/laqi` → Settings → Code security → Dependency graph: Enable. Dependabot alerts: Enable. Dependabot security updates: Enable. (API: `gh api -X PUT repos/csdev19/laqi/vulnerability-alerts`; `gh api -X PUT repos/csdev19/laqi/automated-security-fixes`.)
2. Same page → Secret scanning: Enable; Push protection: Enable.
3. Settings → Actions → General → Workflow permissions: select "Read repository contents and packages permissions"; untick "Allow GitHub Actions to create and approve pull requests". (API: `gh api -X PUT repos/csdev19/laqi/actions/permissions/workflow -f default_workflow_permissions=read -F can_approve_pull_request_reviews=false`.)
4. **Only after R2 is merged:** Settings → Actions → General → tick "Require actions to be pinned to a full-length commit SHA". (API: `gh api -X PUT repos/csdev19/laqi/actions/permissions -F enabled=true -f allowed_actions=all -F sha_pinning_required=true`.) Doing this before R2 fails every workflow.
5. Account Settings → Billing → Spending limits → Actions: set a non-zero limit and the 75/90/100 % alerts (hub R3).

**B. npm cut-over (R2 merged, before R3)**

6. npmjs.com → `laqi` → Settings → Publishing access: confirm "Require two-factor authentication to publish" is on. Do **not** select "disallow tokens" yet.
7. Same page → Trusted Publisher → Add → GitHub Actions: Organization or user `csdev19`; Repository `laqi`; Workflow filename `release-npm.yml` (filename only, with extension); Environment name `production`. Save. The token path still works.
8. Merge R3. Run "Publish to npm" from the Actions tab with `dry_run` ticked; expect green up to the skipped publish step.
9. Merge the next release PR. Watch the `publish` job. `E404` → the tuple in step 7 does not match the run (check filename and environment), fix it, then "Re-run failed jobs". `ENEEDAUTH` → npm did not attempt OIDC: check `node-version: 24`, that no `NODE_AUTH_TOKEN` is set, and that `id-token: write` is on the job; fix on `main` and publish that version once from a clean checkout of the tag with the granular token (`cd apps/cli && npm publish --access public`), then re-run the next release normally.
10. After a green OIDC publish: npmjs.com → Access Tokens → revoke the granular `laqi` token. github.com → Settings → Environments → `production` → delete `NPM_TOKEN`. npmjs.com → `laqi` → Publishing access → select "Require two-factor authentication and disallow tokens".

**C. Environments and rulesets (after B10)**

11. Settings → Environments → New environment `release-please`: no reviewers; Deployment branches and tags → "Selected branches and tags" → add branch `main`; Environment secrets → add `RELEASE_PLEASE_TOKEN` (same value as today). Merge R4. Then delete `RELEASE_PLEASE_TOKEN` from `production`.
12. Settings → Environments → `production`: Required reviewers → add `csdev19`; leave "Prevent self-review" unticked; Deployment branches and tags → "Selected branches and tags" → add tag `v*`, tag `site-v*`, branch `main`. (If open question 2 is answered "no reviewer", set only the deployment policy.)
13. Settings → Rules → Rulesets → New branch ruleset `main`: Enforcement Active; Target: Default branch; Rules: Restrict deletions, Block force pushes, Require a pull request before merging (required approvals 0), Require status checks to pass → add `Validate` (leave "Require branches to be up to date" off); Bypass list: empty.
14. Settings → Rules → Rulesets → New tag ruleset `release tags`: Enforcement Active; Target: tags matching `v*` and `site-v*`; Rules: Restrict creations, Restrict updates, Restrict deletions; Bypass list: Repository admin (role). Confirm on the next release that release-please still creates the tag; if it is blocked, the PAT is not receiving the admin bypass and the ruleset must add `csdev19` explicitly.
15. Fine-grained PAT hygiene: note `RELEASE_PLEASE_TOKEN`'s expiry date in a calendar; it needs Contents read/write and Pull requests read/write only.

**D. After the first Dependabot run (any time after R2)**

16. Insights → Dependency graph → Dependabot → open the `bun` job log. If `hono`, `zod`, `typescript`, `tsdown`, `@types/bun`, `vitest` never appear in any PR over two weekly runs, answer open question 1.

## Acceptance mapping

| Acceptance criterion                               | Where it is met                                                                                                                                                                                                                         |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun audit` shows no production advisory above low | D1 + D9: `bun run audit` is `--prod --audit-level=moderate`; the production closure has zero advisories after the hono bump (verified against the Advisory DB on 2026-10-12); the consumer smoke repeats the check with npm's resolver. |
| Every action SHA-pinned                            | F3 + the workflow test + `sha_pinning_required`.                                                                                                                                                                                        |
| Dependabot or Renovate enabled — decided           | D4 Dependabot, with the reopen condition in the ADR.                                                                                                                                                                                    |
| `verify` covers every package                      | D10: every workspace with TypeScript sources has `check-types` (`config` has none and is exempt by test), root files are covered by `check-types:root`, `scripts/` by `check-types:scripts`.                                            |

## References

- GitHub Advisory Database entries: [GHSA-88fw-hqm2-52qc](https://github.com/advisories/GHSA-88fw-hqm2-52qc), [GHSA-8j4g-w8fx-2239](https://github.com/advisories/GHSA-8j4g-w8fx-2239), [GHSA-5xrq-8626-4rwp](https://github.com/advisories/GHSA-5xrq-8626-4rwp), [GHSA-85c8-ppgw-ccpr](https://github.com/advisories/GHSA-85c8-ppgw-ccpr); the per-package counts above come from `GET /advisories?ecosystem=npm&affects=<pkg>@<version>`.
- [hono v4.13.0 release notes](https://github.com/honojs/hono/releases/tag/v4.13.0); [SmartRouter source at v4.13.13](https://github.com/honojs/hono/blob/v4.13.13/src/router/smart-router/router.ts).
- [npm Trusted Publishers](https://docs.npmjs.com/trusted-publishers/) — npm ≥ 11.5.1, Node ≥ 22.14, publisher fields, automatic provenance, "disallow tokens" setting.
- [actions/setup-node advanced usage — Trusted Publisher (OIDC)](https://github.com/actions/setup-node/blob/main/docs/advanced-usage.md); [setup-node v7.0.0 release](https://github.com/actions/setup-node/releases/tag/v7.0.0) ("Remove dummy NODE_AUTH_TOKEN export").
- [GitHub: Security hardening for GitHub Actions](https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions) — SHA pinning, "Require actions to be pinned to a full-length commit SHA", read-only default token, environment reviewers.
- [GitHub: Dependabot supported ecosystems](https://docs.github.com/en/code-security/dependabot/ecosystems-supported-by-dependabot/supported-ecosystems-and-repositories) — Bun: version updates yes, security updates no; [Dependabot options reference](https://docs.github.com/en/code-security/dependabot/working-with-dependabot/dependabot-options-reference); [Dependency graph supported ecosystems](https://docs.github.com/en/code-security/supply-chain-security/understanding-your-software-supply-chain/dependency-graph-supported-package-ecosystems) (no Bun entry).
- [GitHub: Available rules for rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets).
- [Bun: `bun audit`](https://bun.com/docs/pm/cli/audit) — `--prod`, `--audit-level`, exit codes.
- [Renovate Bun manager](https://docs.renovatebot.com/modules/manager/bun/).
- [Vitest 3 migration](https://v3.vitest.dev/guide/migration.html), [Vitest 4 migration](https://v4.vitest.dev/guide/migration.html), [Vitest 5 migration](https://vitest.dev/guide/migration).
- [release-please-action v5.0.0](https://github.com/googleapis/release-please-action/releases/tag/v5.0.0); [actions/checkout releases](https://github.com/actions/checkout/releases); [wrangler-action v4.0.0](https://github.com/cloudflare/wrangler-action/releases/tag/v4.0.0).
- [@hono/node-server v2.0.0](https://github.com/honojs/node-server/releases/tag/v2.0.0) — Node ≥ 20, Vercel adapter removed (not adopted here).
- Node.js release index (`https://nodejs.org/dist/index.json`): 24.5.0 is the first 24.x with npm 11.5.1; 24.21.0 ships npm 11.19.0.
- general-knowledge hub: `monorepos/release-gated-verification.md` (R1–R8, tier table), `monorepos/release-please-playbook.md` (step 3 token, step 6 skip), `monorepos/pr-checks.md` (gate-job pattern), `monorepos/monorepo-structure.md` (catalog).
- Audit reports: `workspace-temp/audits/security-scan.md` (F1, F4, F5, F9, F10, F13), `workspace-temp/audits/small-units.md` (root tooling, CI), `workspace-temp/audits/SUMMARY.md` items 5, 12. Partial attempt read for ideas: `workspace-temp/audits/partial-fixes/fix-deps-and-ci.patch` (its `npm install -g npm@^11.5.1` step is replaced by Node 24; its narrowed root `tsconfig.json` and `tokens/tsconfig.json` are adopted; its `overrides` for `tinypool` are replaced by the `oxfmt` upgrade).
