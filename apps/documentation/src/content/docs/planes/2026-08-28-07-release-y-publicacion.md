---
title: "laqi v2 — Plan 7: Release automation and publishing"
---

# laqi v2 — Plan 7: Release automation and publishing

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `laqi` installable from npm on a `beta` dist-tag, released by merging a release PR instead of by hand, with a PR gate that keeps the repository formatted, typed and green.

**Architecture:** release-please runs in manifest mode with a **single version line** anchored at the repository root, because commits route to a package by the paths they touch and laqi's code lives in `packages/*`. `extra-files` writes that version into `apps/cli/package.json`, the one package that ships. Three workflows, each with one job: `validate.yml` gates PRs, `release-please.yml` cuts releases, `release-npm.yml` publishes on the tag. The only real logic in the pipeline — deriving the npm dist-tag from the version — lives in a tested TypeScript module rather than inline bash, because getting it wrong publishes the beta as `latest`.

**Tech Stack:** release-please v4 (`googleapis/release-please-action@v4`), GitHub Actions, Bun 1.3.4 for install/build, Node 22 + `npm publish --provenance` for publishing, oxlint + oxfmt for the gate, vitest for the dist-tag tests.

**Spec:** `apps/documentation/src/content/docs/decisiones/0010-release-y-npm.md` — this plan argues from it; read both.

## Global Constraints

- **English everywhere** — code, comments, test names, commit messages, documentation (ADR-0009).
- **Conventional Commits.** A mistyped `feat!` moves the public version line.
- **Three separate pull requests, in this order.** Task 1 is PR A, Task 2 is PR B, Tasks 3–7 are PR C. PR A must merge before PR C, or the format gate is red on arrival.
- **Never push to `main`.** Every change ships as a PR.
- **The beta line must stay on `X.0.0-beta`.** Any other shape lets an ordinary `feat` produce a final version — see the state table in ADR-0010.
- **Bun is the package manager** (`packageManager: bun@1.3.4`). The root `workspaces.catalog` is a Bun-only feature; npm and pnpm cannot install this repository.
- `bun run check` and `bun run format` keep their current **mutating** behaviour. CI uses the new non-mutating `check:ci`.
- The seven `packages/*` stay `private: true` at `2.0.0`. They are not versioned.

## Verified before writing this plan (do not re-litigate)

- `oxfmt --check` reports **77 of 198 files** unformatted on `main` — `laqi-v2-data-generators`, the branch that carried this figure before, has since merged. oxfmt only consults the root `.gitignore`, so `.astro/` and `.tanstack/` must be listed there or the gate goes red again the moment something builds.
- `oxfmt` formats **Markdown** (11 of the 198 files it processes), so the docs need no separate prose formatter. It honours `.gitignore`, so `dist/` is untouched.
- `oxlint` exits **0** on the twelve current warnings. Only `correctness` is `error`.
- `npm pack` on `apps/cli` produces **9 files** including `dist/panel/`, with `bin: {"laqi": "./dist/index.mjs"}`. The published `package.json` carries `@laqi/*` as literal `workspace:*` in `devDependencies`; this is inert (consumers never install a dependency's devDependencies) and is **out of scope**.
- The repository has **zero git tags**, so seeding the manifest cannot collide.
- `bootstrap-sha` is `8354e21ec809df759756326dfd49706f34be6059`, deliberately three commits behind the current `main` — see ADR-0010 for why.

## File Structure

| File                                   | Responsibility                                                                                       |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `scripts/release/dist-tag.ts`          | Pure functions: version → npm dist-tag, and tag → version. The only branching logic in the pipeline. |
| `scripts/release/dist-tag.test.ts`     | Its tests.                                                                                           |
| `scripts/release/print-dist-tag.ts`    | Thin CLI wrapper the workflow calls. No logic.                                                       |
| `release-please-config.json`           | Version topology. Root-anchored, one line, prerelease strategy.                                      |
| `.release-please-manifest.json`        | The seed: `1.2.1`.                                                                                   |
| `.github/workflows/validate.yml`       | PR gate: format, lint, build, types, tests.                                                          |
| `.github/workflows/release-please.yml` | Cuts releases. Nothing else.                                                                         |
| `.github/workflows/release-npm.yml`    | Publishes on a tag. Nothing else.                                                                    |
| `package.json` (root)                  | Gains `check:ci`.                                                                                    |
| `vitest.config.ts`                     | Include pattern extended to cover `scripts/`.                                                        |
| `examples/todo-app/package.json`       | Consumes `laqi` by package name.                                                                     |
| `README.md`                            | The release process, for humans.                                                                     |

---

### Task 1: Format the repository (PR A)

Mechanical and reviewable as such. Must merge before PR C.

**Files:**

- Modify: 77 files across the repository (whatever `oxfmt` rewrites; matches the 77 of 198 files `oxfmt --check` reports on a clean checkout, with no generated files present)

**Interfaces:**

- Consumes: nothing
- Produces: a repository where `oxfmt --check .` exits 0 — the precondition for Task 5's gate

- [ ] **Step 1: Branch from `main`**

```bash
git checkout main && git pull
git checkout -b style/format-repo
```

- [ ] **Step 2: Confirm the gate is red before the change**

Run: `bunx oxfmt --check .`
Expected: exits non-zero, `Format issues found in above 77 files`

- [ ] **Step 3: Record the pre-change test baseline**

Run: `bun run test`
Expected: PASS. Write down the passing count; Step 6 must match it.

- [ ] **Step 4: Format**

```bash
bunx oxfmt --write .
```

- [ ] **Step 5: Confirm the gate is now green**

Run: `bunx oxfmt --check .`
Expected: exits 0, no files listed

- [ ] **Step 6: Make the gate survive a build**

oxfmt only reads the `.gitignore` in the directory it is invoked from.
`apps/documentation/.gitignore` already excludes `.astro/` and
`examples/todo-app/.gitignore` already excludes `.tanstack/`, but the root
`.gitignore` — the one oxfmt actually consults when run from the repository
root — excludes neither. Add both, with a comment explaining why the
apparent duplication is load-bearing:

```
# oxfmt only reads the .gitignore in the directory it runs from, so these
# duplicate the nested apps/documentation and examples/todo-app ignores —
# without them a build regenerates files the gate then flags as unformatted.
.astro/
.tanstack/
```

Then prove it against a real build, not just the source tree:

```bash
bun run build
bunx oxfmt --check .
```

Expected: exits 0 even after the build has regenerated Astro's and
TanStack's output.

- [ ] **Step 7: Confirm nothing broke**

```bash
bun run test
bunx turbo run check-types --force
bun run build
```

Expected: the same passing count as Step 3, types clean, build clean. Formatting must be behaviour-preserving; a changed count means investigate, do not proceed.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "style: format the repository with oxfmt

The \`check\` script runs \`oxfmt --write\`, so it rewrote files instead of
verifying them and could never fail. The repository had drifted to 77 of 198
files unformatted. This is the one-time catch-up; ADR-0010 adds a
non-mutating \`check:ci\` and a CI gate so it cannot drift again.

No behaviour change."
```

- [ ] **Step 9: Open PR A and merge it**

```bash
gh pr create --title "style: format the repository with oxfmt" --body "Mechanical. \`oxfmt --write .\` over the repository, no behaviour change. Precondition for the format gate in ADR-0010."
```

> **After merging:** rebase `chore/example-consumes-laqi` and `ci/release-please-and-npm-publish` onto the new `main` and re-run `bunx oxfmt --write .` there. Formatting conflicts resolve by re-running the formatter, never by hand-editing.

---

### Task 2: The example consumes `laqi` by name (PR B)

**Files:**

- Modify: `examples/todo-app/package.json`

**Interfaces:**

- Consumes: nothing
- Produces: `node_modules/.bin/laqi` inside the workspace; the `mock` and `mock:dev` scripts

- [ ] **Step 1: Branch from `main`**

```bash
git checkout main && git pull
git checkout -b chore/example-consumes-laqi
```

- [ ] **Step 2: Show the current script is a path, not a reference**

Run: `grep '"mock"' examples/todo-app/package.json`
Expected: `"mock": "node ../../apps/cli/dist/index.mjs",`

- [ ] **Step 3: Declare the dependency and rewrite the scripts**

In `examples/todo-app/package.json`, change the `scripts` block to:

```json
  "scripts": {
    "dev": "vite dev --port 3000",
    "build": "vite build",
    "mock": "laqi",
    "mock:dev": "bun ../../apps/cli/src/index.ts",
    "check-types": "tsc --noEmit -p ."
  },
```

and add `laqi` to `devDependencies`, keeping the keys alphabetical:

```json
    "@vitejs/plugin-react": "^4.3.4",
    "laqi": "workspace:*",
    "typescript": "5.9.3",
```

`mock` is the package reference and is what a real consumer would run. `mock:dev` runs the TypeScript source with no build step, for iterating on laqi itself.

- [ ] **Step 4: Link it**

```bash
bun install
```

- [ ] **Step 5: Verify the symlink and the bin exist**

```bash
ls -l examples/todo-app/node_modules/laqi
ls -l node_modules/.bin/laqi examples/todo-app/node_modules/.bin/laqi 2>/dev/null
```

Expected: `laqi` resolves to `apps/cli`, and a `laqi` bin symlink exists in at least one of the two `.bin` directories. Note which one — Step 7 depends on it.

> The bin target is `apps/cli/dist/index.mjs`, which does not exist until a build. A dangling symlink here is expected, not a failure.

- [ ] **Step 6: Verify the dev path works with no build at all**

```bash
rm -rf apps/cli/dist
cd examples/todo-app && bun run mock:dev --port 8123
```

Expected: `⚡ laqi  http://127.0.0.1:8123` and `watching ./laqi/ · 7 endpoints`. Stop it with Ctrl-C.

- [ ] **Step 7: Verify the package reference works after a build**

```bash
cd ../.. && bun run build
cd examples/todo-app && bun run mock --port 8123
```

Expected: the same banner, now via `node_modules/.bin/laqi` rather than a relative path.

Confirm it is really serving:

```bash
curl -s http://127.0.0.1:8123/profile
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8123/__laqi
```

Expected: the profile JSON, and `200`. Stop the server.

- [ ] **Step 8: Confirm the dependency edge did not break the graph**

Run: `bunx turbo run build --dry=json | python3 -c "import json,sys; d=json.load(sys.stdin); print([t['taskId'] for t in d['tasks']])"`
Expected: the task list includes both `laqi#build` and `@laqi/example-todo-app#build`, and the command exits 0 (turbo errors on a dependency cycle).

- [ ] **Step 9: Commit and open PR B**

```bash
git add examples/todo-app/package.json bun.lock
git commit -m "chore(examples): consume laqi as a package, not a relative path

The example invoked the CLI as \`node ../../apps/cli/dist/index.mjs\` because
nothing in the workspace depended on \`laqi\`, so Bun never linked it and no
bin existed. Declaring it as \`workspace:*\` gives the example the same
reference a real consumer uses, and lets turbo order the builds.

\`mock:dev\` keeps the no-build path for iterating on laqi itself."
gh pr create --title "chore(examples): consume laqi as a package, not a relative path" --body "Closes the relative-path wart from ADR-0010 section A."
```

---

### Task 3: The dist-tag rule, with tests (PR C)

The one piece of real logic. `npm publish` marks a version `latest` even when it is a prerelease, so this function is what stops the first beta from replacing the 2022 v1 for every existing user.

**Files:**

- Create: `scripts/release/dist-tag.ts`
- Create: `scripts/release/dist-tag.test.ts`
- Create: `scripts/release/print-dist-tag.ts`
- Modify: `vitest.config.ts`

**Interfaces:**

- Consumes: nothing
- Produces: `distTagFor(version: string): string` and `versionFromTag(tag: string): string`, both throwing `Error` on malformed input. Task 6's workflow calls `print-dist-tag.ts`.

- [ ] **Step 1: Branch from `main`**

```bash
git checkout main && git pull
git checkout -b ci/release-please-and-npm-publish
```

> If the branch already exists carrying ADR-0010, check it out instead and rebase it onto `main`.

- [ ] **Step 2: Let vitest see `scripts/`**

Replace the `include` line in `vitest.config.ts`:

```ts
    include: ['{packages,apps}/*/src/**/*.test.{ts,tsx}', 'scripts/**/*.test.ts'],
```

- [ ] **Step 3: Write the failing tests**

Create `scripts/release/dist-tag.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { distTagFor, versionFromTag } from './dist-tag'

describe('distTagFor', () => {
  it('sends a plain release to latest', () => {
    expect(distTagFor('2.0.0')).toBe('latest')
    expect(distTagFor('10.20.30')).toBe('latest')
  })

  // The whole point: npm would tag these `latest` on its own, replacing the
  // 1.2.1 that every existing `npx laqi` user gets today.
  it('sends a prerelease to a tag named after its identifier', () => {
    expect(distTagFor('2.0.0-beta')).toBe('beta')
    expect(distTagFor('2.0.0-beta.0')).toBe('beta')
    expect(distTagFor('2.0.0-beta.17')).toBe('beta')
    expect(distTagFor('3.0.0-rc.1')).toBe('rc')
  })

  it('ignores build metadata', () => {
    expect(distTagFor('2.0.0+build.5')).toBe('latest')
    expect(distTagFor('2.0.0-beta.1+build.5')).toBe('beta')
  })

  // `1.0.0-1` is legal semver, but "1" is not a usable dist-tag name and npm
  // rejects a tag that parses as a version. Failing loudly beats guessing.
  it('refuses a numeric prerelease identifier', () => {
    expect(() => distTagFor('1.0.0-1')).toThrow(/identifier/i)
  })

  // `latest` is the one tag this whole module exists to protect. An
  // identifier that IS `latest` must never slip through as if it were an
  // ordinary tag name — that would silently replace the 1.2.1 that every
  // `npx laqi` user gets today.
  it('refuses a prerelease identifier that is latest, case-insensitively', () => {
    expect(() => distTagFor('2.0.0-latest')).toThrow(/latest/i)
    expect(() => distTagFor('2.0.0-latest.1')).toThrow(/latest/i)
    expect(() => distTagFor('2.0.0-LATEST.1')).toThrow(/latest/i)
  })

  // npm refuses a dist-tag that parses as a valid semver version or range.
  // Catching this here beats discovering it as a CI break at publish time.
  it('refuses a prerelease identifier that would be read as a version or range', () => {
    expect(() => distTagFor('2.0.0-x.1')).toThrow(/identifier/i)
    expect(() => distTagFor('2.0.0-v1.5')).toThrow(/identifier/i)
    expect(() => distTagFor('2.0.0-2.1')).toThrow(/identifier/i)
  })

  it('refuses anything that is not a semver version', () => {
    expect(() => distTagFor('v2.0.0')).toThrow(/not a valid semver/i)
    expect(() => distTagFor('2.0')).toThrow(/not a valid semver/i)
    expect(() => distTagFor('')).toThrow(/not a valid semver/i)
  })
})

describe('versionFromTag', () => {
  it('strips the leading v', () => {
    expect(versionFromTag('v2.0.0-beta.0')).toBe('2.0.0-beta.0')
    expect(versionFromTag('v2.0.0')).toBe('2.0.0')
  })

  it('refuses a tag without the v prefix', () => {
    expect(() => versionFromTag('2.0.0')).toThrow(/must start with/i)
  })

  it('refuses a tag whose remainder is not a version', () => {
    expect(() => versionFromTag('vlatest')).toThrow(/not a valid semver/i)
  })
})
```

- [ ] **Step 4: Run them and watch them fail**

Run: `bunx vitest run scripts/release/dist-tag.test.ts`
Expected: FAIL — `Failed to resolve import "./dist-tag"`

- [ ] **Step 5: Write the implementation**

Create `scripts/release/dist-tag.ts`:

```ts
/**
 * Deriving the npm dist-tag from the version.
 *
 * `npm publish` tags a version `latest` unless told otherwise — it does NOT
 * infer anything from a `-beta` suffix. Publishing 2.0.0-beta.0 without an
 * explicit `--tag` would therefore hand the beta to everyone still running
 * `npx laqi` against the 1.2.1 published in 2022. See ADR-0010.
 */

const SEMVER =
  /^(?<major>0|[1-9]\d*)\.(?<minor>0|[1-9]\d*)\.(?<patch>0|[1-9]\d*)(?:-(?<prerelease>[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+(?<build>[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/

/** The npm dist-tag a version should be published under. */
export function distTagFor(version: string): string {
  const match = SEMVER.exec(version)
  if (!match?.groups) {
    throw new Error(`${JSON.stringify(version)} is not a valid semver version`)
  }

  const { prerelease } = match.groups
  if (prerelease === undefined) return 'latest'

  // `2.0.0-beta.1` -> `beta`. The counter is not part of the tag name, or
  // every beta would land on its own tag and `laqi@beta` would resolve to
  // nothing.
  const identifier = prerelease.split('.')[0]
  if (/^\d+$/.test(identifier)) {
    throw new Error(
      `${JSON.stringify(version)} has a numeric prerelease identifier (${identifier}); ` +
        'npm rejects a dist-tag that parses as a version. Name the prerelease, e.g. -beta.1',
    )
  }

  // `latest` is the one tag this whole module exists to protect: a
  // prerelease whose identifier IS `latest` must never come back looking
  // like an ordinary tag name, or it would silently replace the 1.2.1 that
  // every `npx laqi` user gets today. Compared case-insensitively — npm
  // dist-tags are case-sensitive, so `LATEST` would not literally collide
  // with `latest`, but a tag named `LATEST` sitting beside `latest` is a
  // trap for whoever reads the tag list next.
  if (identifier.toLowerCase() === 'latest') {
    throw new Error(
      `${JSON.stringify(version)} has a prerelease identifier (${identifier}) that reads as ` +
        '"latest"; that would publish over the tag every existing user resolves. ' +
        'Name the prerelease something else, e.g. -beta.1',
    )
  }

  // npm refuses a dist-tag that parses as a valid semver version or range
  // (`v1`, `1`, `2.0`, `x`, `X`, `*`). Reject those here rather than fail at
  // publish time.
  if (/^[vV]?\d/.test(identifier) || /^[xX*]$/.test(identifier)) {
    throw new Error(
      `${JSON.stringify(version)} has a prerelease identifier (${identifier}) that npm would ` +
        'read as a version or a range; it rejects a dist-tag like that. ' +
        'Name the prerelease something else, e.g. -beta.1',
    )
  }

  return identifier
}

/** The version carried by a release tag: `v2.0.0-beta.0` -> `2.0.0-beta.0`. */
export function versionFromTag(tag: string): string {
  if (!tag.startsWith('v')) {
    throw new Error(`release tag ${JSON.stringify(tag)} must start with "v"`)
  }

  const version = tag.slice(1)
  if (!SEMVER.test(version)) {
    throw new Error(`${JSON.stringify(version)} is not a valid semver version`)
  }

  return version
}
```

- [ ] **Step 6: Run the tests and watch them pass**

Run: `bunx vitest run scripts/release/dist-tag.test.ts`
Expected: PASS, 10 tests

- [ ] **Step 7: Add the CLI wrapper**

Create `scripts/release/print-dist-tag.ts`. It holds no logic so there is nothing to test in it:

```ts
#!/usr/bin/env bun
// Prints the dist-tag for a version, after checking it against the release
// tag when there is one. Used by .github/workflows/release-npm.yml.
//
//   bun scripts/release/print-dist-tag.ts 2.0.0-beta.0                 -> beta
//   bun scripts/release/print-dist-tag.ts 2.0.0-beta.0 v2.0.0-beta.0   -> beta
//   bun scripts/release/print-dist-tag.ts 2.0.0       v2.0.0-beta.0    -> exit 1
//
// The comparison lives here rather than in shell so it is covered by
// dist-tag.test.ts: a mismatch means extra-files did not run and the tarball
// would ship stamped with the wrong number.
import { distTagFor, versionFromTag } from './dist-tag'

const [, , version, tag] = process.argv

if (version === undefined) {
  console.error('usage: print-dist-tag.ts <version> [release-tag]')
  process.exit(1)
}

try {
  if (tag !== undefined) {
    const tagged = versionFromTag(tag)
    if (tagged !== version) {
      throw new Error(
        `tag ${tag} carries version ${tagged}, but apps/cli/package.json says ${version}`,
      )
    }
  }
  console.log(distTagFor(version))
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
```

- [ ] **Step 8: Verify the wrapper end to end**

```bash
bun scripts/release/print-dist-tag.ts 2.0.0-beta.0                   # -> beta
bun scripts/release/print-dist-tag.ts 2.0.0                          # -> latest
bun scripts/release/print-dist-tag.ts 2.0.0-beta.0 v2.0.0-beta.0     # -> beta
bun scripts/release/print-dist-tag.ts 2.0.0 v2.0.0-beta.0; echo "exit=$?"  # -> mismatch, exit=1
bun scripts/release/print-dist-tag.ts nonsense; echo "exit=$?"       # -> stderr message, exit=1
```

- [ ] **Step 9: Confirm the whole suite still passes**

Run: `bun run test`
Expected: PASS, including the 8 new tests

- [ ] **Step 10: Commit**

```bash
git add scripts/release vitest.config.ts
git commit -m "feat(release): derive the npm dist-tag from the version

npm publish marks a version latest even when it is a prerelease — it does not
read the -beta suffix. Without this, the first 2.0.0-beta would replace the
1.2.1 that every existing \`npx laqi\` user gets.

The rule lives in a tested module rather than inline bash because getting it
wrong is a public, irreversible mistake."
```

---

### Task 4: release-please configuration (PR C)

**Files:**

- Create: `release-please-config.json`
- Create: `.release-please-manifest.json`

**Interfaces:**

- Consumes: nothing
- Produces: the tag shape `v<version>` that Task 6's publish workflow triggers on

- [ ] **Step 1: Write the config**

Create `release-please-config.json`:

```json
{
  "$schema": "https://raw.githubusercontent.com/googleapis/release-please/main/schemas/config.json",
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
      ],
      "changelog-sections": [
        { "type": "feat", "section": "Features" },
        { "type": "fix", "section": "Bug Fixes" },
        { "type": "perf", "section": "Performance Improvements" },
        { "type": "revert", "section": "Reverts" },
        { "type": "refactor", "section": "Code Refactoring" },
        { "type": "chore", "section": "Miscellaneous Chores", "hidden": true },
        { "type": "docs", "section": "Documentation", "hidden": true },
        { "type": "style", "section": "Styles", "hidden": true },
        { "type": "test", "section": "Tests", "hidden": true },
        { "type": "build", "section": "Build System", "hidden": true },
        { "type": "ci", "section": "Continuous Integration", "hidden": true }
      ]
    }
  }
}
```

`versioning` and `prerelease` are both required: without `prerelease: true` the strategy computes the prerelease bump and then strips the suffix. `include-component-in-tag: false` is what yields `v2.0.0-beta.0` instead of `laqi-monorepo-v2.0.0-beta.0`.

- [ ] **Step 2: Seed the manifest**

Create `.release-please-manifest.json`:

```json
{ ".": "1.2.1" }
```

`1.2.1` is the last version genuinely published to npm. release-please only moves forward, so seeding at the repository's aspirational `2.0.0` would make `2.0.0-beta` unreachable.

- [ ] **Step 3: Verify both files are valid JSON and agree with the schema's key names**

```bash
python3 -c "import json;c=json.load(open('release-please-config.json'));m=json.load(open('.release-please-manifest.json'));assert set(c['packages'])==set(m), 'package keys must match';print('ok:', list(m.items()))"
```

Expected: `ok: [('.', '1.2.1')]`

- [ ] **Step 4: Commit**

```bash
git add release-please-config.json .release-please-manifest.json
git commit -m "ci: configure release-please with a single version line

Anchored at the root because commits route to a package by the paths they
touch and laqi's code lives in packages/*; extra-files writes the version
into apps/cli/package.json, the only package that ships.

Seeded at 1.2.1, the last version actually published, so the prerelease
strategy can reach 2.0.0-beta."
```

---

### Task 5: The PR gate (PR C)

**Files:**

- Modify: `package.json` (root)
- Create: `.github/workflows/validate.yml`

**Interfaces:**

- Consumes: a formatted repository (Task 1)
- Produces: `bun run check:ci`

- [ ] **Step 1: Add the non-mutating script**

In the root `package.json` `scripts` block, add `check:ci` immediately after `check`:

```json
    "check": "bun run lint && bun run format",
    "check:ci": "oxlint && oxfmt --check .",
```

`check` and `format` are left alone on purpose: they are the local habit, and they write.

- [ ] **Step 2: Prove `check:ci` verifies instead of writing**

```bash
git stash list > /dev/null
printf '\n\n\n' >> README.md
bun run check:ci; echo "exit=$?"
git diff --stat README.md
git checkout -- README.md
```

Expected: `check:ci` exits non-zero, **and** `git diff --stat` shows README.md still modified — proving it reported rather than fixed. (Run `bun run check` instead and it would have rewritten the file and exited 0.)

- [ ] **Step 3: Confirm it passes on the clean tree**

Run: `bun run check:ci`
Expected: exit 0

> If this fails, Task 1 has not merged into `main` yet, or this branch is not rebased on it. Fix that before continuing — do not weaken the gate.

- [ ] **Step 4: Write the workflow**

Create `.github/workflows/validate.yml`:

```yaml
name: Validate ✅

# Gates pull requests into main. Deploys nothing, publishes nothing.
on:
  pull_request:
    branches: [main]

permissions:
  contents: read

concurrency:
  group: validate-${{ github.head_ref }}
  # A superseded push has nothing worth finishing.
  cancel-in-progress: true

jobs:
  validate:
    name: Validate
    runs-on: ubuntu-latest
    # A release PR only touches package.json and CHANGELOG.md. Running the
    # full matrix on a mechanical version bump buys nothing.
    if: ${{ !startsWith(github.head_ref, 'release-please--') }}
    steps:
      - uses: actions/checkout@v4

      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.3.4

      # Bun-only: the root workspaces.catalog is not understood by npm or pnpm.
      - run: bun install --frozen-lockfile

      # Cheapest first, so a formatting slip fails in seconds.
      - name: Lint and format
        run: bun run check:ci

      - name: Build
        run: bun run build

      - name: Check types
        run: bun run check-types

      - name: Test
        run: bun run test
```

- [ ] **Step 5: Validate the YAML parses**

`Bun.YAML.parse` is built in as of Bun 1.3, so this needs no dependency:

```bash
bun -e '
const wf = Bun.YAML.parse(await Bun.file(".github/workflows/validate.yml").text())
const steps = wf.jobs.validate.steps
console.log(steps.map((s) => s.name ?? s.uses))
console.log("skips release PRs:", wf.jobs.validate.if.includes("release-please--"))
'
```

Expected: the seven steps listed in order, and `skips release PRs: true`.

- [ ] **Step 6: Run locally exactly what CI will run**

```bash
bun install --frozen-lockfile
bun run check:ci && bun run build && bun run check-types && bun run test
```

Expected: all four green. If they are not green here, they will not be green in CI.

- [ ] **Step 7: Commit**

```bash
git add package.json .github/workflows/validate.yml
git commit -m "ci: gate pull requests on format, lint, types and tests

CI cannot call \`check\`: it runs \`oxfmt --write\`, so it rewrites files
instead of verifying them and can never fail — which is how the repository
reached 77 of 198 files unformatted unnoticed. \`check:ci\` verifies.

Release PRs are skipped: they touch only package.json and CHANGELOG.md."
```

---

### Task 6: The release and publish workflows (PR C)

**Files:**

- Create: `.github/workflows/release-please.yml`
- Create: `.github/workflows/release-npm.yml`

**Interfaces:**

- Consumes: `scripts/release/print-dist-tag.ts` (Task 3), `release-please-config.json` (Task 4)
- Produces: tags matching `v*`, and a published npm package

- [ ] **Step 1: Write the release cutter**

Create `.github/workflows/release-please.yml`:

```yaml
name: Release Please 🏷️

# Cuts releases and ONLY cuts releases. Publishing lives in release-npm.yml so
# a failed publish can never leave a release half-cut.
on:
  push:
    branches: [main]

permissions:
  contents: write
  pull-requests: write

concurrency:
  group: release-${{ github.ref }}
  # Never cancel a half-finished release cut — queue instead.
  cancel-in-progress: false

jobs:
  release-please:
    name: Release Please
    runs-on: ubuntu-latest
    # RELEASE_PLEASE_TOKEN lives in the `production` environment. A job only
    # sees an environment's secrets when it declares that environment;
    # `production` has no protection rules, so this does not gate the run.
    environment: production
    steps:
      - uses: googleapis/release-please-action@v4
        with:
          # NOT the default GITHUB_TOKEN: GitHub suppresses the events it
          # raises, so the tag would appear and release-npm.yml would never
          # fire. This is the single most common way this setup fails.
          token: ${{ secrets.RELEASE_PLEASE_TOKEN }}
          config-file: release-please-config.json
          manifest-file: .release-please-manifest.json
```

- [ ] **Step 2: Write the publisher**

Create `.github/workflows/release-npm.yml`:

```yaml
name: Publish to npm 📦

# Publishes apps/cli (the `laqi` package). Trigger: the tag cut by
# release-please.yml. The tag ref is what gets checked out, so what ships is
# exactly the released commit.
#
# Re-publish is impossible by design — npm never allows reusing a version.
# workflow_dispatch exists for the dry run and for retrying a publish whose
# tag was cut but whose run failed.
on:
  push:
    tags: ["v*"]
  workflow_dispatch:
    inputs:
      dry_run:
        description: "Build and pack, but do not publish"
        type: boolean
        default: true

permissions:
  contents: read
  # Required for npm provenance. The repository is public, so npm can record a
  # verifiable link from the tarball back to this run.
  id-token: write

concurrency:
  group: publish-${{ github.ref }}
  cancel-in-progress: false

jobs:
  publish:
    name: Publish
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v4

      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.3.4

      # Bun builds; npm publishes. `npm publish --provenance` needs npm >= 9.5,
      # which `bun publish` has no equivalent for.
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          registry-url: https://registry.npmjs.org

      - run: bun install --frozen-lockfile

      # tsdown fails the build if packages/editor/dist is missing, so a
      # panel-less tarball cannot reach npm.
      - run: bun run build

      - name: Resolve version and dist-tag
        id: meta
        run: |
          set -euo pipefail
          VERSION="$(node -p "require('./apps/cli/package.json').version")"

          # On a tag push the tag is the authority, and print-dist-tag refuses
          # to print anything if it disagrees with apps/cli/package.json — that
          # mismatch means extra-files did not run and the tarball would ship
          # stamped with the wrong number. On workflow_dispatch there is no
          # tag, so only the version is passed.
          if [ "${{ github.event_name }}" = "push" ]; then
            DIST_TAG="$(bun scripts/release/print-dist-tag.ts "$VERSION" "$GITHUB_REF_NAME")"
          else
            DIST_TAG="$(bun scripts/release/print-dist-tag.ts "$VERSION")"
          fi

          echo "version=${VERSION}" >> "$GITHUB_OUTPUT"
          echo "dist_tag=${DIST_TAG}" >> "$GITHUB_OUTPUT"
          echo "Publishing ${VERSION} under dist-tag ${DIST_TAG}"

      - name: Pack and show what would ship
        working-directory: apps/cli
        run: npm pack --dry-run

      - name: Publish
        if: ${{ github.event_name == 'push' || inputs.dry_run == false }}
        working-directory: apps/cli
        run: npm publish --provenance --access public --tag "${{ steps.meta.outputs.dist_tag }}"
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}

      - name: Summary
        run: |
          {
            echo "### laqi ${{ steps.meta.outputs.version }}"
            echo ""
            echo "- dist-tag: \`${{ steps.meta.outputs.dist_tag }}\`"
            echo "- published: ${{ github.event_name == 'push' || inputs.dry_run == false }}"
          } >> "$GITHUB_STEP_SUMMARY"
```

- [ ] **Step 3: Validate both files parse and the publish guard reads correctly**

```bash
bun -e '
for (const f of [".github/workflows/release-please.yml", ".github/workflows/release-npm.yml"]) {
  const wf = Bun.YAML.parse(await Bun.file(f).text())
  console.log(f, "->", Object.keys(wf.jobs))
}
const npmWf = Bun.YAML.parse(await Bun.file(".github/workflows/release-npm.yml").text())
const publish = npmWf.jobs.publish.steps.find((s) => s.name === "Publish")
if (!publish.run.includes("--tag") || !publish.run.includes("--provenance")) {
  throw new Error("publish must pass --tag and --provenance")
}
console.log("publish guard:", publish.if)
console.log("id-token:", npmWf.permissions["id-token"])
'
```

Expected: both jobs listed, the publish step's `if` printed, and `id-token: write`. A missing `--tag` throws — that is the check that matters.

- [ ] **Step 4: Confirm the dist-tag the pipeline would pick for the seeded version**

```bash
bun scripts/release/print-dist-tag.ts 2.0.0-beta.0
```

Expected: `beta` — not `latest`. This is the assertion that protects existing v1 users.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/release-please.yml .github/workflows/release-npm.yml
git commit -m "ci: cut releases with release-please and publish to npm on the tag

Two workflows, one job each: a failed publish can never leave a release
half-cut. The publish derives its dist-tag from the version, so a prerelease
cannot take over \`latest\` from the 1.2.1 published in 2022, and refuses to
run if the tag and apps/cli/package.json disagree."
```

---

### Task 7: Document the process and open PR C

**Files:**

- Modify: `README.md`

**Interfaces:**

- Consumes: everything above
- Produces: the human-readable release procedure

- [ ] **Step 1: Replace the pre-release note at the top of `README.md`**

Change the status blockquote to:

````markdown
> **Status: v2 beta.** `laqi@beta` on npm is this v2. Plain `laqi` is still
> the unrelated 1.2.1 from 2022 and will stay that way until v2 is declared
> final.
>
> ```
> bunx laqi@beta        # or: npx laqi@beta
> ```
````

- [ ] **Step 2: Add a Releasing section at the end of `README.md`**

```markdown
## Releasing

Releases are cut by [release-please](https://github.com/googleapis/release-please)
and published by GitHub Actions. Nobody publishes from a laptop.

1. Merge normal PRs into `main` with Conventional Commit titles.
2. release-please maintains a rolling **release PR** that accumulates the
   changelog and recomputes the version. Read it.
3. **Merging that release PR is the act of releasing.** It bumps
   `apps/cli/package.json`, writes `CHANGELOG.md`, and pushes a `v*` tag.
4. The tag triggers `release-npm.yml`, which builds and publishes.

The dist-tag is derived from the version: anything with a `-` goes to its
prerelease tag (`beta`), anything else to `latest`. See
[ADR-0010](apps/documentation/src/content/docs/decisiones/0010-release-y-npm.md).

**The beta line must stay on `X.0.0-beta`.** On any other shape, an ordinary
`feat` produces a final version and takes over `latest`.

To rehearse the pipeline without publishing, run **Publish to npm** from the
Actions tab with `dry_run` checked.

### Setup, once

Two secrets in the repository's `production` environment:

| Secret | What | Why |
| --- | --- | --- |
| `RELEASE_PLEASE_TOKEN` | Fine-grained PAT, Contents + Pull requests read/write | A tag pushed by the default `GITHUB_TOKEN` does not trigger workflows |
| `NPM_TOKEN` | npm granular token, read/write on `laqi` only | Publishing |
```

- [ ] **Step 3: Verify the README is formatted (oxfmt covers Markdown)**

Run: `bun run check:ci`
Expected: exit 0

- [ ] **Step 4: Full green before opening the PR**

```bash
bun run check:ci && bun run build && bun run check-types && bun run test
```

Expected: all green.

- [ ] **Step 5: Commit and open PR C**

```bash
git add README.md
git commit -m "docs: document the release process"
gh pr create --title "ci: adopt release-please and publish laqi to npm" --body "Implements ADR-0010. Requires PR A (repo format) to be merged first, and the two production-environment secrets to exist."
```

- [ ] **Step 6: Merge PR C with the version-forcing footer**

> **This is the step that decides the first published version, and it cannot be done from a branch commit — the footer must land in the squash commit on `main`.**

When squash-merging PR C, set the commit **body** to include both lines:

```
feat!: adopt release-please and publish to npm

BREAKING CHANGE: laqi v2 is a complete rewrite with an interface
incompatible with the 1.2.1 published in 2022.

Release-As: 2.0.0-beta.0
```

`Release-As` forces the exact first version. The `feat!` is the fallback: if
the footer is not honoured, a breaking change from the seeded `1.2.1` still
lands on `2.0.0-beta`, the same stable shape.

- [ ] **Step 7: Verify the release PR before anything ships**

Opening a release PR is free — nothing has been published at this point.

1. A PR titled `chore(main): release 2.0.0-beta.0` appears within a minute or two.
2. Its `CHANGELOG.md` contains only commits since `bootstrap-sha`, not years of history.
3. It bumps **both** the root `package.json` and `apps/cli/package.json`. If only the root moved, `extra-files` is wrong — fix it before merging.

If no release PR appears at all, the batch contained nothing releasable, or `RELEASE_PLEASE_TOKEN` is missing.

- [ ] **Step 8: Rehearse the publish before merging the release PR**

Actions → **Publish to npm** → Run workflow → leave `dry_run` checked.
Expected: green, and the log's `npm pack --dry-run` lists 9 files including `dist/panel/index.html`. The summary reports dist-tag `beta`.

- [ ] **Step 9: Release**

Merge the release PR. Then verify, in order:

```bash
git fetch --tags && git tag -l          # v2.0.0-beta.0 exists
gh run list --workflow=release-npm.yml  # a run started
npm view laqi dist-tags                 # latest: 1.2.1, beta: 2.0.0-beta.0
```

**If the tag exists but no run started, the PAT is wrong** — that is the single most common failure. Fix the token, then re-run the publish from the Actions tab with `dry_run` unchecked.

- [ ] **Step 10: Verify as a real consumer, outside the monorepo**

Inside the monorepo the workspace member named `laqi` shadows the registry, so this must run elsewhere:

```bash
cd "$(mktemp -d)"
bun init -y
bun add -d laqi@beta
bunx laqi --help
```

Expected: the v2 usage banner. Later betas arrive with `bun update laqi`.

Confirm the v1 users are untouched:

```bash
cd "$(mktemp -d)" && bun init -y && bun add -d laqi && cat node_modules/laqi/package.json | grep '"version"'
```

Expected: `1.2.1`.

---

## Self-review

**Spec coverage.** Every section of ADR-0010 maps to a task: topology and
`extra-files` → Task 4; the two prerelease keys and the `1.2.1` seed → Task 4
plus the merge footer in Task 7 Step 6; the dist-tag rule → Task 3; the two
workflows → Task 6; the validation gate, `check:ci` and the one-time format
→ Tasks 1 and 5; the tokens → Task 7's README table and the verification in
Step 9.

**Known gaps, deliberate.** The `workspace:*` specifiers in the published
`devDependencies` are left alone (inert, and out of scope). `--deny-warnings`
is not enabled; the twelve oxlint warnings stay visible and non-blocking.
`apps/documentation` is not deployed.

**Ordering risk.** Task 1 must merge before Task 5's gate arrives, or PR C is
red on arrival. Task 1 also forces a rebase of `chore/example-consumes-laqi`
and `ci/release-please-and-npm-publish`; resolve those conflicts by
re-running `oxfmt --write .`, never by hand.
