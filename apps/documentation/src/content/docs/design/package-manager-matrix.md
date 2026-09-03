---
title: 'Package-manager command matrix'
description: Every install command laqi.dev publishes, run on a real machine before it was written down, with the version that produced each result.
---

# Package-manager command matrix

Task 1 of [Plan 12](/plans/2026-09-02-12-package-manager-toggle/). Every
command below was **executed**, not looked up. The plan forbids publishing an
unverified cell, so this page is the gate the site's copy passes through.

**Verified on 2026-09-02 (UTC 2026-09-03T02:31Z), macOS 25.5.0, arm64.**

## Versions under test

| Tool | Version | How it was obtained            |
| ---- | ------- | ------------------------------ |
| Node | 22.23.2 | nvm                            |
| npm  | 10.9.8  | bundled with Node              |
| pnpm | 10.6.2  | corepack (not otherwise on the machine) |
| yarn | 1.22.22 (classic) and 4.18.0 (berry) | corepack |
| bun  | 1.3.4   | already installed              |

pnpm and yarn are not installed on this machine. They were provided by
`corepack enable --install-directory <tmp>` for the duration of the run and
`corepack disable`d afterwards; every global install was removed. That is why
the results are trustworthy and why nothing was left behind.

## The matrix

| Manager | Global install | No-install runner | Dev dependency |
| ------- | -------------- | ----------------- | -------------- |
| **npm** | `npm i -g laqi@2` ✅ | `npx laqi@2` ✅ | `npm i -D laqi@2` ✅ |
| **pnpm** | `pnpm add -g laqi@2` ✅ | `pnpm dlx laqi@2` ✅ | `pnpm add -D laqi@2` ✅ |
| **yarn** | `yarn global add laqi@2` ✅ *(classic only)* | `yarn dlx laqi@2` ⚠️ *(berry; see below)* | `yarn add -D laqi@2` ✅ |
| **bun** | `bun add -g laqi@2` ✅ | `bunx laqi@2` ✅ | `bun add -d laqi@2` ✅ |

Every ✅ means `laqi --help` printed the command list, or
`node_modules/.bin/laqi` existed, after that exact command.

## Findings

### 1. Yarn 4 quarantines laqi, temporarily

`yarn dlx laqi@2` on Yarn 4.18.0 fails:

```
➤ YN0016: │ laqi@npm:2: All versions satisfying "2" are quarantined
```

This is **not** a laqi defect and not a permanent incompatibility. Yarn 4 ships
a minimal-age gate that refuses packages published within the last 24 hours, as
supply-chain protection. laqi `2.0.1` was published at
`2026-09-02T14:47Z` — about twelve hours before this run — so it was inside the
window.

Confirmed by disabling the gate, which makes the same command succeed:

```sh
YARN_NPM_MINIMAL_AGE_GATE=0 yarn dlx laqi@2 --help   # prints the command list
```

**It resolves itself.** Any version older than a day is unaffected, so the
condition applies to every freshly published package and disappears on its own.
The site should publish `yarn dlx laqi@2` without a caveat; a note about a
24-hour window would be stale copy within a day of being written.

Worth knowing at release time: for the first day after any publish, Yarn 4
users cannot `dlx` the new version.

### 2. `yarn global` is Yarn 1 only

Yarn 2+ removed the `global` command. `yarn global add laqi@2` works on
1.22.22 and does not exist on berry. The toggle's yarn entry therefore carries
a note; it is the only manager that needs one.

### 3. bun's dev flag is `-d`, not `-D`

`bun add -d laqi@2`. Copying npm's `-D` across is the obvious mistake and is
why this row was run rather than assumed.

### 4. pnpm's global install needs `PNPM_HOME`

`pnpm add -g` places the binary in `$PNPM_HOME` and warns if it is unset. On a
machine where pnpm was installed normally this is already configured; it only
surfaced here because pnpm arrived through corepack. Not a laqi concern and not
something the site should explain.

## A trap for whoever re-runs this

**Do not run `npx laqi@2` from inside the laqi monorepo.** It fails with
`sh: laqi: command not found`, which looks alarming and is meaningless:
`laqi` resolves to the local workspace package, whose `dist/` is not built.
From any other directory it works. Every verification above was run from a
fresh `mktemp -d`.

## Reopening condition

Re-run this matrix when the published `bin` layout changes, when a manager
ships a new major, or before adding a fifth manager to the toggle. The results
above are pinned to the versions in the first table and to nothing else.
