---
title: ADR-0018 — Dependency version policy for the published CLI
---

# ADR-0018 — Dependency version policy for the published CLI

**Status:** Proposed
**Date:** 2026-10-12
**Spec:** [Supply-chain hardening](/design/supply-chain-hardening/) (NIW2-312)

## Context

`laqi` is one published package whose eight runtime dependencies are installed by npm on the user's machine (`apps/cli/package.json`). Three of them (`hono`, `typescript`, `zod`) are pinned exactly; the catalog in the root `package.json` repeats the pins so every workspace resolves one copy, and a test keeps the two in step.

The pin on `hono@4.12.3` (2026-02-26) outlived 38 advisories, two in the CORS middleware laqi mounts on every mock, for seven months. No user received a fix, because the pin is what the registry hands out. The intent behind the pin was reproducibility, but an npm consumer never sees `bun.lock`: the transitive closure (40 packages) was already resolved by ranges on their machine. The exact pin bought staleness and nothing else.

A second question follows: if ranges are the rule, how does the version CI tested stay close to the version users resolve, and who moves it?

## Decision

1. **Every runtime dependency of the published CLI is a caret range** (`^MAJOR.MINOR.PATCH`) whose floor is the version `bun.lock` resolves. Exact pins and tilde ranges are not allowed in `apps/cli/package.json#dependencies`. The catalog holds the same range strings for the packages it shares with the CLI, so the single-copy guarantee inside the monorepo is unchanged.
2. **`bun.lock` is the tested version.** CI installs with `--frozen-lockfile`; a range change and its lockfile land in the same PR.
3. **Runtime dependencies stay unbundled.** tsdown folds in only the workspace packages and the SDKs it already bundles for tree-shaking reasons (`@modelcontextprotocol/sdk`, `@clack/*`). The eight runtime dependencies are installed by the consumer's package manager.
4. **Dependabot moves the floor**, weekly, with minor and patch updates grouped into one PR per ecosystem and majors as individual PRs; `bun` and `github-actions` ecosystems. A major bump of a runtime dependency is never grouped and carries a changelog-visible commit.
5. **The production gate is what ships, not the dev tree.** `bun audit --prod --audit-level=moderate` runs locally and in CI; the release gate additionally packs the tarball, installs it with npm in an empty directory, audits that install and runs the binary.

## Alternatives rejected

**Exact pins (status quo).** The strongest argument is that a user installs exactly what CI tested. It is false for a package without a consumer lockfile: only the direct dependency is fixed, its closure is not, and the direct one is then the only thing that cannot receive a patch. Rejected on the evidence of `hono@4.12.3`.

**Bundle every runtime dependency into `dist/`.** Zero install-time variance and a faster `npx`. Rejected: `chokidar` relies on the optional native `fsevents`, which a bundle cannot carry; `typescript` is 23 MB and loaded lazily on first use by design, which bundling would undo or complicate; every upstream patch would then require a laqi release, moving the staleness problem rather than solving it; and the tarball's licence and attribution surface grows by forty packages.

**Renovate instead of Dependabot.** Renovate's npm manager understands catalogs explicitly, pins action digests and maintains lockfiles. Rejected for now because it is a third-party GitHub App with write access to the repository, which is the kind of standing capability this work removes elsewhere, and Dependabot is native, keeps the `# vX.Y.Z` comment beside pinned SHAs, and GitHub documents Bun version updates. Reopen condition below.

**Tilde ranges for "risky" dependencies.** Patch-only ranges would narrow the gap between tested and resolved versions. Rejected: minor releases are where upstream ships most security fixes (hono's CORS fixes landed in 4.12.25 and 4.12.34, then 4.13.x), and a tilde would again hold users on an unpatched minor.

**`typescript` as an optional peer.** Saves 23 MB per install for users who never paste TypeScript models. Not rejected on merit; deferred, because `npx laqi` must keep working with no extra step and the generation stack is already lazy. Its own ticket.

## Consequences

**Good.** Users receive upstream patches on their next install without waiting for a laqi release. Advisory noise on `laqi` in downstream audits disappears as soon as the floor is raised. The repository has one place where versions live (the catalog), one place where the tested version lives (`bun.lock`), and a bot that moves both.

**Costs.** A fresh install may resolve a newer patch than CI tested; the weekly Dependabot cadence and the pack-install smoke in the release gate bound that gap to days and to "it installs, audits clean and starts". Dependabot's handling of `catalog:` entries is unverified at the time of this decision. Majors of runtime dependencies (`effect` 4, `chokidar` 5, `@hono/node-server` 2, `typescript` 6/7) will arrive as PRs and each needs a human decision; none is implied by this ADR.

## Non-goals

- Pinning or bundling policy for dev dependencies; they do not ship, and `bun.lock` already pins them for contributors.
- A consumer-side lockfile or `npm shrinkwrap`; a `npm-shrinkwrap.json` in the tarball would restore exact installs for users at the price of freezing the closure again, and is rejected for the same reason as exact pins.
- Provenance verification by consumers.

## Reopen condition

- Dependabot leaves `catalog:` entries untouched after two consecutive weekly runs: adopt Renovate for the `bun` ecosystem (keeping Dependabot for `github-actions` is acceptable).
- A runtime dependency ships a breaking change inside a minor or patch that reaches users before CI: narrow that one dependency to a tilde range with a comment naming the incident, and keep the rest.
- A bundled-everything build is measured to be smaller than the install it replaces and `chokidar` no longer needs `fsevents`: revisit bundling.
