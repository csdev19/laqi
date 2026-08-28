---
title: "ADR-0010 — Release automation and publishing to npm"
---

# ADR-0010 — Release automation and publishing to npm

**Status:** Accepted
**Date:** 2026-08-28

## Context

laqi v2 has never been published. The `laqi` name on npm is ours, but what
sits there is `laqi@1.2.1` from April 2022 — a different program: an
Express-based mock library with an incompatible interface. Anyone running
`npx laqi` today gets that.

The repository state at the time of this decision:

- **One publishable package.** `apps/cli` is `laqi`. The seven workspace
  packages (`core`, `schema`, `server`, `editor`, `generate`, `mcp`,
  `config`) are all `private: true` and get bundled into the CLI by tsdown —
  one tarball ships, not eight.
- **No CI of any kind.** There is no `.github/` directory.
- **No git tags.** Zero. Nothing to collide with.
- **Conventional Commits already in use** on `main`, with squash merges.
- `apps/cli/package.json` says `2.0.0`, a number that was never released.

Publishing by hand from a laptop is how the version in `package.json` and the
version actually on the registry drift apart. `release-automation.md` in
general-knowledge opens with exactly that failure: a tag that merely
_triggers_ a build does not _set_ the built version, so artifacts ship
stamped with a stale number and the update feed never advertises anything
new. We want the shipped version to be a committed fact before it is a tag.

## Decision

**Adopt release-please in manifest mode with a single version line, and
publish to npm from a tag-triggered workflow.**

### One version line, anchored at the root, written into the package

```json
{
  "release-type": "node",
  "include-component-in-tag": false,
  "bootstrap-sha": "8354e21ec809df759756326dfd49706f34be6059",
  "packages": {
    ".": {
      "changelog-path": "CHANGELOG.md",
      "exclude-paths": ["apps/documentation", "examples"],
      "versioning": "prerelease",
      "prerelease": true,
      "prerelease-type": "beta",
      "extra-files": [
        { "type": "json", "path": "apps/cli/package.json", "jsonpath": "$.version" }
      ]
    }
  }
}
```

`versioning`, `prerelease`, and `prerelease-type` all sit inside the `"."`
package rather than at the top level: release-please's schema forbids
`prerelease-type` at root (`additionalProperties: false`, and the key is
defined only inside the package-scoped `ReleaserConfigOptions`), and a root
key the schema silently drops would leave `prereleaseType` undefined —
producing a plain final `2.0.0` where a `2.0.0-beta` was intended.

The package entry is `"."` and not `apps/cli`, because **release-please
routes commits to a package by the paths they touch** and essentially all of
laqi's code lives in `packages/*`. Anchored at `apps/cli`, a `fix(editor):`
would touch no file under `apps/cli/**` and would cut no release — the
"no release PR after a `packages/*`-only change" gotcha in the playbook.

Anchoring at the root alone would leave `apps/cli/package.json` frozen at
`2.0.0` forever while the tag advanced — the drift this ADR exists to
prevent. `extra-files` closes that: the root entry owns the version line, and
the version is written into the `package.json` that is actually published.

This is the closure rule applied, not sidestepped. The seven private packages
are bundled _into_ the CLI, so **their closure is the CLI**. They cannot ship
independently even in principle. One deployable, one version line.

**The private packages keep their `2.0.0` and stop meaning anything.** They
are consumed through `workspace:*`; nobody resolves those numbers. Versioning
them would buy changelog noise and a plugin dependency
(`node-workspace` / `linked-versions`) whose behaviour on Bun is unverified —
Bun's root `workspaces` is an object, not the array those plugins expect.
Revisit only if one of them is ever published.

### The beta line, and why `2.0.0-beta` specifically

Both `versioning: "prerelease"` **and** `prerelease: true` are required. They
are not redundant. From `PrereleaseVersioningStrategy.determineReleaseType`:

```js
if (!this.prerelease) {
  const bumpedVersion = bumpedVersionUpdater.bump(version);
  return new CustomVersionUpdate(
    Version.parse(`${bumpedVersion.major}.${bumpedVersion.minor}.${bumpedVersion.patch}`)
  );
}
```

With `prerelease` unset, the strategy computes the prerelease bump and then
**strips the suffix**, yielding a plain final version. `prerelease: true` is
what lets the `-beta` survive; it also marks the GitHub Release as a
pre-release.

More importantly, **only `X.0.0-beta` is a stable prerelease state.**
`PrereleaseMinorVersionUpdate` preserves the prerelease only when
`patch === 0`; `PrereleaseMajorVersionUpdate` only when `minor === 0 &&
patch === 0`. Otherwise both fall through to the plain `MinorVersionUpdate` /
`MajorVersionUpdate`, which drop the suffix:

| Current      | `fix`          | `feat`         | `feat!`        |
| ------------ | -------------- | -------------- | -------------- |
| `2.0.1-beta` | `2.0.1-beta.1` | **`2.1.0`**    | **`3.0.0`**    |
| `2.1.0-beta` | `2.1.0-beta.1` | `2.1.0-beta.1` | **`3.0.0`**    |
| `2.0.0-beta` | `2.0.0-beta.1` | `2.0.0-beta.1` | `2.0.0-beta.1` |

On any shape other than `X.0.0-beta`, an ordinary `feat` silently produces a
**final** version. Combined with the dist-tag rule below (no `-` means
`latest`), that would publish v2 as `latest` and replace the 2022 v1 without
anyone having decided to. `2.0.0-beta` is the only fixed point, so the beta
line runs `2.0.0-beta`, `2.0.0-beta.1`, `2.0.0-beta.2`, … for as long as we
want.

**Seeding.** release-please only moves forward, so from `2.0.0` it can never
emit `2.0.0-beta`. `.release-please-manifest.json` is therefore seeded to
**`1.2.1`** — the last version genuinely published, and with zero git tags in
the repo there is nothing to collide with. The adoption commit carries both a
`feat!` breaking-change footer and `Release-As: 2.0.0-beta.0`. The footer is
honest (v2 _is_ an incompatible rewrite of the 2022 package) and it is also
the fallback: if `Release-As` is honoured the first release is exactly
`2.0.0-beta.0`; if it is not, `feat!` from `1.2.1` lands on `2.0.0-beta` —
the same stable shape either way.

`bootstrap-sha` is deliberately three commits behind `main`. Set to the
current HEAD, the first beta's changelog would carry only the release
adoption itself; set to `8354e21`, it also carries the data-generators
`feat` that landed in between, which is the substance of what the first
beta actually contains. The playbook's "use main HEAD" rule exists to stop
the bot dragging years of pre-convention history into the first changelog;
three commits is not that.

Cutting the final `2.0.0` later is a deliberate act: flip `prerelease` to
`false` (the strip branch above then yields `2.0.0`) or land a
`Release-As: 2.0.0`.

### Two workflows, and the dist-tag rule

`release-please.yml` cuts releases and only cuts releases.
`release-npm.yml` publishes on `v*` tags and only publishes. One failing
publish can never leave a release half-cut.

**`npm publish` marks a version `latest` even when it is a prerelease** — it
does not infer the dist-tag from the `-beta` suffix. The publish step
therefore derives the tag from the version: a `-` in the version means
`--tag beta`, no `-` means `--tag latest`. Without that single rule the first
beta would take over `npx laqi` for every existing v1 user.

The workflow also **verifies that `apps/cli/package.json` matches the tag**
before publishing, and carries a `dry_run` input (default `true` on
`workflow_dispatch`) so the pipeline can be proven end to end — install,
build, tarball contents — without publishing anything.

The manual dispatch path may never publish `latest`, only `beta`. A tag
carries the deliberateness release-please put into it — `prerelease: false`
or a `Release-As:` footer — but a `workflow_dispatch` run carries none of
that; it publishes whatever `apps/cli/package.json` happens to say on
whatever ref someone picked. If that computes to `latest`, the step fails
instead of shipping it.

Publishing uses `npm publish` rather than `bun publish` for **provenance**:
the repository is public, so with `id-token: write` npm records a verifiable
link from the tarball back to the commit and workflow that built it. Install
and build still run on Bun.

### Tokens

`RELEASE_PLEASE_TOKEN` (fine-grained PAT, Contents + Pull requests
read/write) and `NPM_TOKEN` (granular, scoped to the `laqi` package only)
live in the `production` environment. The PAT is not optional: a tag pushed
by the default `GITHUB_TOKEN` does not trigger `on: push: tags` workflows —
GitHub suppresses those events to prevent recursion — so with the default
token the release PR merges, the tag appears, and nothing publishes.

## Alternatives considered

**Anchor the package at `apps/cli`.** Rejected: commits route by path, and
the code lives in `packages/*`. A `fix(server):` would cut no release.

**Version the seven private packages in lockstep.** Rejected for now: they
are unpublished and resolved through `workspace:*`, so the numbers are
decoration, and the plugins that maintain them are unverified on Bun.
Revisit if one is ever published.

**Publish by hand.** Rejected: it is precisely the drift this ADR prevents.
Kept only as the `workflow_dispatch` escape hatch.

**semantic-release.** Rejected for the reason in `release-automation.md`: it
leaves `package.json` at `0.0.0-development` and derives the version at
publish time. We want the repository to state the shipped version.

**Start the beta at `2.0.1-beta`.** Rejected once the strategy source was
read: it is not a fixed point, and the next `feat` would ship a final
`2.1.0` as `latest`.

## Consequences

**Good.** The tag, the `package.json` and the published tarball cannot
disagree. Releasing is merging a PR whose changelog you have read. The 2022
v1 keeps `latest` until we deliberately decide otherwise. Provenance makes
the tarball auditable. Rollback is re-running an older tag's workflow run.

**Costs.** Two manually created tokens that expire and will one day fail a
publish with `E401`. The root `package.json` of a private monorepo now
carries a version that is really the CLI's — the price of one line covering a
closure that spans eight packages. Commit discipline stops being cosmetic:
a mistyped `feat!` moves the public version line. And the beta must stay on
`X.0.0-beta` — leaving that shape is a one-way door into a final release.

**Not covered here.** `apps/documentation` is not deployed.

## Addendum — the validation gate

A third workflow, `validate.yml`, runs on pull requests into `main`: build,
`check-types`, the test suite, `oxlint`, and `oxfmt --check`. Per step 6 of
the playbook it skips branches named `release-please--*`, so a mechanical
version bump does not pay for the full matrix.

Two things had to be settled first, both discovered by running the tools.

**The repository's own `check` script cannot gate anything.** It is
`bun run lint && bun run format`, and `format` is `oxfmt --write .`. It
rewrites files instead of verifying them, so it can never fail — which is
why the repository had drifted to **77 of 198 files unformatted** without
anyone noticing. CI therefore calls a new `check:ci`
(`oxlint && oxfmt --check .`); `check` and `format` keep their existing
mutating behaviour so local habits are untouched.

The drift is cleared by a one-time `style:` commit running `oxfmt --write .`
across the repository, landed before the gate is switched on. The
alternative — checking only the files a PR touches — was rejected: it leaves
the repository permanently half-formatted and makes the gate's meaning
depend on the diff.

`oxfmt` formats **Markdown as well** (11 of the 198 files it processes), so
the documentation is covered by the same check; no separate prose formatter
is needed.

**`oxlint` exits 0 on warnings.** Only the `correctness` category is set to
`error` in `.oxlintrc.json`, so the twelve current warnings
(`no-array-sort`, `no-shadow`, `consistent-function-scoping`) are visible in
the log without blocking. `--deny-warnings` is deliberately not used yet: it
would require clearing those twelve first. Reconsider once they are gone.

oxfmt reads only the `.gitignore` in the directory it is invoked from — its
`--ignore-path` help says "in the current directory". This repository has
five nested `.gitignore` files, and `apps/documentation/.gitignore`
excludes `.astro/` while `examples/todo-app/.gitignore` excludes
`.tanstack/`; the root excluded neither. The formatter therefore walked
Astro's and TanStack's generated output, rewrote it, and the gate went red
again after the next build. Both directories are now listed in the ROOT
`.gitignore` with a comment saying why the apparent duplication is
load-bearing. A gate that fails on generated files is a gate the team
deletes.
