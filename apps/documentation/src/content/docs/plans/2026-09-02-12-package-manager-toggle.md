---
title: "Plan 12 — The package-manager toggle on laqi.dev"
---

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a visitor pick npm, pnpm, yarn or bun once and have every install command on laqi.dev change in place — and only publish commands that have actually been run.

**Architecture:** One module owns the commands (`apps/site/src/lib/package-managers.ts`); one Astro component renders them (`InstallCommand.astro`, already the landing page's install block); one inline script sets `data-pm` on `<html>` before first paint and CSS shows the matching variant. Every variant ships in the HTML, so the page is correct with JavaScript off and there is no flash of the wrong command. The two docs pages that carry a fenced install command become `.mdx` and use the same component — a code fence cannot participate in a toggle, and a second copy of the command in markdown is the drift this plan exists to prevent.

**Tech Stack:** Astro 5 + Starlight (already in `apps/site`), plain CSS + ~30 lines of vanilla DOM script (no framework island — the site ships no client framework today and this does not justify the first one), Vitest for `package-managers.ts`.

**Spec:** `apps/documentation/src/content/docs/product/roadmap.md` — the "Package-manager toggle on laqi.dev" section under **Next**, including its closing instruction: _"Before shipping: actually verify the global-install and runner paths on each manager (yarn classic vs berry differ on `global`)."_ Task 1 is that verification, and it runs before any copy is written.

## Global Constraints

- **English everywhere** in code, comments, identifiers, test names, commits and the site's copy (ADR-0009).
- **No command ships unverified.** Task 1 runs every command on a real machine and records the output. A command that fails is not published with a caveat — it is replaced by one that works, or that manager's entry says plainly what it does instead.
- **The `@2` pin stays on every variant.** `laqi@2` installs 2.x specifically and never an older major; dropping the pin on the pnpm line while keeping it on npm would be a silent inconsistency in the thing the page is teaching.
- **No flash of the wrong command.** The `data-pm` attribute is set by a blocking inline script in `<head>`, before the body paints. A `DOMContentLoaded` handler that swaps text afterwards is a visible flicker and is not acceptable.
- **The page works with JavaScript disabled**, showing npm. Every variant is in the HTML; the script only chooses which is visible.
- **One toggle, not five stacked blocks.** The roadmap is explicit that this is not TanStack's "or" list. One line of command text, swapped in place.
- **`localStorage` access is wrapped in try/catch.** Safari in private mode throws on access, and an exception in the head script would leave the page with no `data-pm` at all.
- **No design token is hardcoded.** Colors come from `packages/tokens/src/tokens.css` via the existing CSS custom properties. No new hex literal.
- **Content lint must pass** (`scripts/site/content-lint.ts` bans `Laqi`/`LAQI` outside code spans), and the broken-link check must stay green.
- **`apps/site` never cuts a CLI release** — it is in `release-please-config.json`'s exclude paths already; nothing here changes that.
- **TDD where there is logic to test.** `package-managers.ts` is pure data and pure functions and gets a real test file. The Astro component gets a rendered-output assertion, not a mock.
- **Follow existing conventions:** Conventional Commits, `bun run check:ci` clean before every commit, PR-only workflow.

---

## File structure

```
apps/site/src/
├── lib/
│   ├── package-managers.ts        # the four managers, their commands, the ids
│   └── package-managers.test.ts
├── components/
│   ├── InstallCommand.astro       # modify: renders all variants + the toggle
│   └── PackageManagerScript.astro # the blocking head script, included once
├── content/docs/docs/
│   ├── installation.mdx           # was .md — uses the component
│   └── quick-start.mdx            # was .md — uses the component
└── styles/global.css              # modify: [data-pm] visibility rules
```

`package-managers.ts` is the only file that knows a command string. Everything else asks it.

---

## Task 1: Verify every command on a real machine — before any copy is written

**Files:**

- Create: `apps/documentation/src/content/docs/design/package-manager-matrix.md`

**Interfaces:**

- Consumes: nothing.
- Produces: the verified command matrix that Task 2 hardcodes. **Task 2 cannot start until this table is filled in with real output.**

This is not a formality. The roadmap flagged one known trap — `yarn global add` was removed in yarn 2+ — and a page that teaches a command which errors out is worse than a page that only mentions npm.

- [ ] **Step 1: Record the versions under test**

```bash
node --version
npm --version
pnpm --version || echo "pnpm: not installed"
yarn --version || echo "yarn: not installed"
bun --version || echo "bun: not installed"
```

Write each into the doc. A result is only meaningful next to the version that produced it — especially for yarn, where the whole question is which major is in use.

- [ ] **Step 2: Verify each global install, one at a time, uninstalling between**

Run each pair and record whether `laqi --help` prints the command list:

```bash
npm i -g laqi@2 && laqi --help | head -3 ; npm un -g laqi
pnpm add -g laqi@2 && laqi --help | head -3 ; pnpm rm -g laqi
yarn global add laqi@2 && laqi --help | head -3 ; yarn global remove laqi
bun add -g laqi@2 && laqi --help | head -3 ; bun rm -g laqi
```

Expected trouble, to be confirmed rather than assumed: `yarn global add` exits non-zero on yarn 2+ with a message about `global` having been removed. If it does, record the exact error text — the entry laqi.dev ships for yarn depends on which yarn the visitor has, and the page has to be honest about that.

- [ ] **Step 3: Verify each no-install runner**

```bash
npx --yes laqi@2 --help | head -3
pnpm dlx laqi@2 --help | head -3
yarn dlx laqi@2 --help | head -3
bunx laqi@2 --help | head -3
```

`--help` and not a bare invocation on purpose: a bare `laqi` starts a server and holds the terminal, which makes an automated check hang rather than fail.

- [ ] **Step 4: Verify each per-project install**

`installation.md` currently teaches `npm i -D laqi@2`. Each manager needs its equivalent:

```bash
cd "$(mktemp -d)" && npm init -y >/dev/null
npm i -D laqi@2   && ls node_modules/.bin/laqi
pnpm add -D laqi@2 && ls node_modules/.bin/laqi
yarn add -D laqi@2 && ls node_modules/.bin/laqi
bun add -d laqi@2  && ls node_modules/.bin/laqi
```

Note bun's flag is `-d`, not `-D`. Confirm it rather than trusting this line.

- [ ] **Step 5: Write the matrix**

Create `apps/documentation/src/content/docs/design/package-manager-matrix.md` with a frontmatter `title`, the versions from Step 1, and a table with one row per manager and columns: **global**, **runner**, **dev dependency**, **verified on**, **notes**. Mark anything that failed as failed, with the error text. For a manager that is not installed on the machine, write `not verified` — never a guessed command. An unverified cell blocks that manager from shipping in Task 2.

- [ ] **Step 6: Commit**

```bash
git add apps/documentation/src/content/docs/design/package-manager-matrix.md
git commit -m "docs: record the verified package-manager command matrix"
```

---

## Task 2: The command module

**Files:**

- Create: `apps/site/src/lib/package-managers.ts`
- Create: `apps/site/src/lib/package-managers.test.ts`

**Interfaces:**

- Consumes: the verified matrix from Task 1.
- Produces:
  - `type PackageManagerId = 'npm' | 'pnpm' | 'yarn' | 'bun'`
  - `type PackageManager = { id: PackageManagerId; name: string; global: string; runner: string; dev: string; note?: string }`
  - `const PACKAGE_MANAGERS: readonly PackageManager[]`
  - `const DEFAULT_MANAGER: PackageManagerId` (`'npm'`)
  - `function isPackageManagerId(value: unknown): value is PackageManagerId`

- [ ] **Step 1: Write the failing test**

```ts
// apps/site/src/lib/package-managers.test.ts
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MANAGER,
  isPackageManagerId,
  PACKAGE_MANAGERS,
  type PackageManager,
} from './package-managers'

const commands = (manager: PackageManager) => [manager.global, manager.runner, manager.dev]

describe('PACKAGE_MANAGERS', () => {
  it('covers the four managers the roadmap named', () => {
    expect(PACKAGE_MANAGERS.map((manager) => manager.id)).toEqual(['npm', 'pnpm', 'yarn', 'bun'])
  })

  it('pins every command to laqi@2', () => {
    // The pin is the point of the install page: `laqi` alone can resolve to
    // the 2022 v1. One variant missing the pin teaches the wrong thing to
    // whoever's manager it is.
    for (const manager of PACKAGE_MANAGERS) {
      for (const command of commands(manager)) {
        expect(command).toContain('laqi@2')
      }
    }
  })

  it('names its own binary in every command', () => {
    for (const manager of PACKAGE_MANAGERS) {
      for (const command of commands(manager)) {
        expect(command.split(' ')[0]).toMatch(new RegExp(`^${manager.id}`))
      }
    }
  })

  it('never mentions a version that is not the major pin', () => {
    // A hardcoded 2.0.1 here would go stale on the next release, which is
    // the exact failure `getLaqiVersion()` exists to prevent elsewhere.
    for (const manager of PACKAGE_MANAGERS) {
      for (const command of commands(manager)) {
        expect(command).not.toMatch(/laqi@\d+\.\d+/)
      }
    }
  })

  it('defaults to npm', () => {
    expect(DEFAULT_MANAGER).toBe('npm')
    expect(PACKAGE_MANAGERS[0]?.id).toBe(DEFAULT_MANAGER)
  })
})

describe('isPackageManagerId', () => {
  it('accepts the four ids', () => {
    for (const manager of PACKAGE_MANAGERS) {
      expect(isPackageManagerId(manager.id)).toBe(true)
    }
  })

  it('rejects anything else, including junk out of localStorage', () => {
    // The stored value is user-writable. A stale or tampered key must fall
    // back to npm, not set data-pm to an id no CSS rule matches, which
    // would hide every command on the page.
    for (const value of ['deno', '', null, undefined, 42, {}]) {
      expect(isPackageManagerId(value)).toBe(false)
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run apps/site/src/lib/package-managers.test.ts`
Expected: FAIL — `Failed to resolve import "./package-managers"`.

- [ ] **Step 3: Write the implementation**

Fill each string from the Task 1 matrix. The values below are the expected shape; **replace any that Task 1 proved wrong**, especially yarn.

```ts
// apps/site/src/lib/package-managers.ts

export type PackageManagerId = 'npm' | 'pnpm' | 'yarn' | 'bun'

export type PackageManager = {
  id: PackageManagerId
  /** How the manager writes its own name in its docs. */
  name: string
  /** Install the binary globally. */
  global: string
  /** Run it once without installing. */
  runner: string
  /** Pin it per-project so a team shares one version. */
  dev: string
  /** A caveat that is true for this manager and no other. */
  note?: string
}

/**
 * Every command here was run before it was written down — the matrix with
 * the versions and the output is in the design doc
 * `package-manager-matrix.md`. laqi is a plain npm package, so all four
 * work; the site simply did not say so.
 *
 * The `@2` pin is on every line deliberately: bare `laqi` can still resolve
 * to the 2022 v1.
 */
export const PACKAGE_MANAGERS: readonly PackageManager[] = [
  {
    id: 'npm',
    name: 'npm',
    global: 'npm i -g laqi@2',
    runner: 'npx laqi@2',
    dev: 'npm i -D laqi@2',
  },
  {
    id: 'pnpm',
    name: 'pnpm',
    global: 'pnpm add -g laqi@2',
    runner: 'pnpm dlx laqi@2',
    dev: 'pnpm add -D laqi@2',
  },
  {
    id: 'yarn',
    name: 'yarn',
    global: 'yarn global add laqi@2',
    runner: 'yarn dlx laqi@2',
    dev: 'yarn add -D laqi@2',
    note: 'yarn global add is Yarn 1 only — on Yarn 2+ use yarn dlx, or install with another manager.',
  },
  {
    id: 'bun',
    name: 'bun',
    global: 'bun add -g laqi@2',
    runner: 'bunx laqi@2',
    dev: 'bun add -d laqi@2',
  },
]

export const DEFAULT_MANAGER: PackageManagerId = 'npm'

/** The stored preference is user-writable, so it is validated, not trusted. */
export function isPackageManagerId(value: unknown): value is PackageManagerId {
  return PACKAGE_MANAGERS.some((manager) => manager.id === value)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run apps/site/src/lib/package-managers.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/site/src/lib/package-managers.ts apps/site/src/lib/package-managers.test.ts
git commit -m "feat(site): define the verified install commands for all four managers"
```

---

## Task 3: The head script and the CSS that shows one variant

**Files:**

- Create: `apps/site/src/components/PackageManagerScript.astro`
- Modify: `apps/site/src/styles/global.css`

**Interfaces:**

- Consumes: `DEFAULT_MANAGER`, `isPackageManagerId` from Task 2.
- Produces: the `data-pm` attribute on `<html>`, the `laqi:pm` DOM event, and `window.__laqiSetPm(id)`.

The order matters and is the whole reason this is its own task: the attribute is set by a **blocking** script in `<head>`, so the first paint already has the right command. Anything that runs after the body renders is a flicker.

- [ ] **Step 1: Write the component**

```astro
---
// apps/site/src/components/PackageManagerScript.astro
// Included once, in <head>, BEFORE the body renders. It sets data-pm on
// <html> so CSS can pick the visible command on first paint — a script that
// swapped text on DOMContentLoaded would show npm and then flicker.
import { DEFAULT_MANAGER } from '../lib/package-managers'
---

<script is:inline define:vars={{ fallback: DEFAULT_MANAGER }}>
  ;(() => {
    const ids = ['npm', 'pnpm', 'yarn', 'bun']
    const KEY = 'laqi:pm'

    const read = () => {
      try {
        const stored = localStorage.getItem(KEY)
        return ids.includes(stored) ? stored : fallback
      } catch {
        // Safari in private mode throws on access. An exception here would
        // leave data-pm unset and every command hidden.
        return fallback
      }
    }

    const apply = (id) => {
      document.documentElement.dataset.pm = id
      try {
        localStorage.setItem(KEY, id)
      } catch {
        // The choice still applies to this page; it just will not persist.
      }
      document.dispatchEvent(new CustomEvent('laqi:pm', { detail: id }))
    }

    document.documentElement.dataset.pm = read()

    // The toggle buttons call this. Exposed on window rather than wired with
    // listeners here because the buttons are rendered per component instance
    // and this script runs before any of them exist.
    window.__laqiSetPm = (id) => {
      if (ids.includes(id)) apply(id)
    }
  })()
</script>
```

- [ ] **Step 2: Include it in both layouts**

The landing page (`src/pages/index.astro`) and Starlight's docs pages need it. For the landing page, add `<PackageManagerScript />` inside `<head>`. For Starlight, add it via the `head` option in `astro.config.mjs`, or a `src/components/Head.astro` override registered under `components.Head` — read the existing `astro.config.mjs` and use whichever mechanism the site already uses for head content rather than introducing a second one.

- [ ] **Step 3: Add the CSS**

```css
/* apps/site/src/styles/global.css — append */

/* One command visible at a time. With no data-pm (JavaScript off, or the
   head script threw), the npm variant is the one that shows. */
.pm-variant {
  display: none;
}
.pm-variant[data-pm-id='npm'] {
  display: inline;
}
[data-pm='pnpm'] .pm-variant[data-pm-id='npm'],
[data-pm='yarn'] .pm-variant[data-pm-id='npm'],
[data-pm='bun'] .pm-variant[data-pm-id='npm'] {
  display: none;
}
[data-pm='pnpm'] .pm-variant[data-pm-id='pnpm'],
[data-pm='yarn'] .pm-variant[data-pm-id='yarn'],
[data-pm='bun'] .pm-variant[data-pm-id='bun'] {
  display: inline;
}

.pm-tabs {
  display: inline-flex;
  gap: 0.5rem;
}
.pm-tab {
  background: none;
  border: none;
  padding: 0;
  color: var(--dim);
  font-family: var(--mono);
  font-size: 0.85em;
  cursor: pointer;
}
.pm-tab:hover {
  color: var(--fg);
}
[data-pm='npm'] .pm-tab[data-pm-id='npm'],
[data-pm='pnpm'] .pm-tab[data-pm-id='pnpm'],
[data-pm='yarn'] .pm-tab[data-pm-id='yarn'],
[data-pm='bun'] .pm-tab[data-pm-id='bun'] {
  color: var(--mint);
}
.pm-note {
  display: none;
  color: var(--dim);
  font-size: 0.85em;
}
[data-pm='yarn'] .pm-note[data-pm-id='yarn'] {
  display: block;
}
```

- [ ] **Step 4: Verify the site still builds**

Run: `cd apps/site && bunx astro build`
Expected: build succeeds. Then confirm the attribute is server-rendered nowhere and the script is inline in the output:

Run: `grep -c "__laqiSetPm" apps/site/dist/index.html`
Expected: `1`.

- [ ] **Step 5: Commit**

```bash
git add apps/site/src/components/PackageManagerScript.astro apps/site/src/styles/global.css apps/site/astro.config.mjs
git commit -m "feat(site): set the package-manager preference before first paint"
```

---

## Task 4: `InstallCommand` renders every variant and the toggle

**Files:**

- Modify: `apps/site/src/components/InstallCommand.astro`

**Interfaces:**

- Consumes: `PACKAGE_MANAGERS` from Task 2, the `data-pm` attribute and `window.__laqiSetPm` from Task 3.
- Produces: `<InstallCommand variant="global" | "runner" | "dev" extra={string[]} tabs={boolean} />`, all props optional (`variant` defaults to `"global"`, `tabs` to `true`).

- [ ] **Step 1: Write the component**

```astro
---
// apps/site/src/components/InstallCommand.astro
import { PACKAGE_MANAGERS } from '../lib/package-managers'

type Props = {
  /** Which of the three commands to show. */
  variant?: 'global' | 'runner' | 'dev'
  /** Lines printed under the command, unchanged by the toggle — e.g. `laqi init`. */
  extra?: string[]
  /** Hide the tabs where a second toggle on the same page would be noise. */
  tabs?: boolean
}

const { variant = 'global', extra = [], tabs = true } = Astro.props

// Every variant is in the HTML and CSS picks one. That is what makes the
// page correct with JavaScript off and free of a first-paint flicker.
---

<div class="install-command">
  {
    tabs && (
      <div class="pm-tabs" role="group" aria-label="package manager">
        {PACKAGE_MANAGERS.map((manager) => (
          <button type="button" class="pm-tab" data-pm-id={manager.id} data-pm-pick={manager.id}>
            {manager.name}
          </button>
        ))}
      </div>
    )
  }

  <div class="install-line">
    <span class="prompt">$</span>
    <code>
      {
        PACKAGE_MANAGERS.map((manager) => (
          <span class="pm-variant" data-pm-id={manager.id}>
            {manager[variant]}
          </span>
        ))
      }
    </code>
    <button type="button" class="copy">copy</button>
  </div>

  {extra.map((line) => (
    <div class="install-line">
      <span class="prompt">$</span>
      <code>{line}</code>
    </div>
  ))}

  {
    PACKAGE_MANAGERS.filter((manager) => manager.note).map((manager) => (
      <p class="pm-note" data-pm-id={manager.id}>{manager.note}</p>
    ))
  }
</div>

<script>
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-pm-pick]')) {
    button.addEventListener('click', () => {
      window.__laqiSetPm?.(button.dataset.pmPick!)
    })
  }

  // The copy button reads the command out of the DOM rather than from a
  // data attribute: with four variants in the markup, a data-copy string
  // would have to be re-synced on every toggle, and the visible text is
  // already the single source of truth for what is on screen.
  for (const button of document.querySelectorAll<HTMLButtonElement>('.install-command .copy')) {
    button.addEventListener('click', () => {
      const line = button.closest('.install-line')
      const visible = line?.querySelector<HTMLElement>('.pm-variant:not([hidden])')
      const text = [...(line?.querySelectorAll<HTMLElement>('.pm-variant') ?? [])]
        .find((span) => span.offsetParent !== null)
        ?.textContent?.trim()
      navigator.clipboard.writeText(text ?? visible?.textContent?.trim() ?? '')
      const original = button.textContent
      button.textContent = 'copied'
      setTimeout(() => {
        button.textContent = original
      }, 1500)
    })
  }
</script>

<style>
  /* Keep the existing .install-command, .prompt, code and .copy rules from
     this file exactly as they are — only .install-line is new. */
  .install-line {
    display: inline-flex;
    align-items: center;
    gap: 0.75rem;
  }
</style>
```

Preserve the component's existing `<style>` block. This task changes what is rendered, not how it looks.

- [ ] **Step 2: Add the type declaration for the global**

```ts
// apps/site/src/env.d.ts — create if absent, otherwise append
declare global {
  interface Window {
    /** Set by PackageManagerScript.astro, before the body paints. */
    __laqiSetPm?: (id: string) => void
  }
}
export {}
```

- [ ] **Step 3: Verify the build and the rendered output**

Run: `cd apps/site && bunx astro build`
Then:

```bash
grep -o 'pnpm add -g laqi@2' apps/site/dist/index.html | head -1
grep -o 'yarn global add laqi@2' apps/site/dist/index.html | head -1
grep -o 'bun add -g laqi@2' apps/site/dist/index.html | head -1
```

Expected: each prints its command once — all four variants are in the static HTML, which is what makes the no-JS case correct.

- [ ] **Step 4: Check it by eye, in a browser**

Run: `cd apps/site && bunx astro preview`
Confirm, in order: the page loads showing npm; clicking `bun` swaps the command in place with no layout shift; reloading keeps bun; selecting `yarn` shows the Yarn 1 note and no other; `copy` puts the _visible_ command on the clipboard. Then disable JavaScript and reload: npm shows, no tab is highlighted, nothing is blank.

- [ ] **Step 5: Commit**

```bash
git add apps/site/src/components/InstallCommand.astro apps/site/src/env.d.ts
git commit -m "feat(site): swap the install command in place across four managers"
```

---

## Task 5: The docs pages use the component

**Files:**

- Delete: `apps/site/src/content/docs/docs/installation.md`
- Create: `apps/site/src/content/docs/docs/installation.mdx`
- Delete: `apps/site/src/content/docs/docs/quick-start.md`
- Create: `apps/site/src/content/docs/docs/quick-start.mdx`
- Modify: `apps/site/package.json` (add `@astrojs/mdx` if it is not already a dependency)
- Modify: `apps/site/astro.config.mjs` (register the integration if newly added)

**Interfaces:**

- Consumes: `InstallCommand` from Task 4.
- Produces: nothing executable. Both pages keep their exact routes (`/docs/installation/`, `/docs/quick-start/`) — the extension changes, the slug does not.

A fenced code block cannot participate in the toggle, and leaving `npm i -g laqi@2` hardcoded in markdown recreates the drift this plan exists to remove. Starlight renders `.mdx` natively; check whether `@astrojs/mdx` is already installed before adding it (`grep mdx apps/site/package.json`).

- [ ] **Step 1: Convert `installation.md`**

Rename to `.mdx`, keep the frontmatter, and replace the two install snippets:

```mdx
---
title: Installation
description: Install the laqi binary — every package manager, requirements, and verifying it runs.
---

import InstallCommand from '../../../components/InstallCommand.astro'

<InstallCommand />

The `@2` pin matters: it installs laqi 2.x specifically, never an older
major. One global binary, no account, no cloud, no project dependencies.

Prefer not to install globally? Run it on demand:

<InstallCommand variant="runner" tabs={false} />

Or pin it per-project, so the whole team gets the same version:

<InstallCommand variant="dev" tabs={false} />
```

`tabs={false}` on the second and third: three toggles stacked on one page is the "or"-block pile the roadmap ruled against. One set of tabs at the top drives all three blocks, because they all read the same `data-pm`.

Update the description line in the frontmatter too — it currently says "npm", which stops being true with this change.

Keep the rest of the page (**Requirements**, **Verify**, **Next step**) exactly as it is.

- [ ] **Step 2: Convert `quick-start.md`**

Rename to `.mdx`, and replace step 1's fence, which is two lines of which only the first is manager-specific:

```mdx
import InstallCommand from '../../../components/InstallCommand.astro'

<InstallCommand extra={['laqi init']} />
```

Everything else on the page is unchanged.

- [ ] **Step 3: Verify the routes did not move**

Run: `cd apps/site && bunx astro build`
Then:

```bash
test -f apps/site/dist/docs/installation/index.html && echo "installation ok"
test -f apps/site/dist/docs/quick-start/index.html && echo "quick-start ok"
```

Expected: both print. If either is missing, the content collection is not picking up `.mdx` — check `src/content.config.ts` for an extension filter.

- [ ] **Step 4: Verify no hardcoded install command survives**

```bash
grep -rn "npm i -g laqi" apps/site/src --include=*.md --include=*.mdx --include=*.astro
```

Expected: no output. The only place that string exists is `package-managers.ts`.

- [ ] **Step 5: Run the site checks**

Run: `bunx vitest run scripts/site apps/site`
Expected: PASS — content lint and the link check included. If the link checker walks `.md` only, extend it to `.mdx` in this commit rather than leaving two pages unchecked.

- [ ] **Step 6: Commit**

```bash
git add apps/site/src/content/docs/docs apps/site/package.json apps/site/astro.config.mjs
git commit -m "feat(site): drive the docs install commands from the toggle"
```

---

## Task 6: Roadmap, and ship

**Files:**

- Modify: `apps/documentation/src/content/docs/product/roadmap.md`

- [ ] **Step 1: Move the entry**

Delete **Package-manager toggle on laqi.dev** from "Next", add a row to the Shipped table pointing at this PR, and update **Last reviewed**. If Task 1 found that a command does not work on some manager version, say which in the row — the roadmap's job is to be accurate about what shipped, and "all four managers" would be a claim the matrix contradicts.

- [ ] **Step 2: Run the full verification**

Run: `bun run verify`
Expected: PASS.

- [ ] **Step 3: Commit and open the PR**

```bash
git add apps/documentation/src/content/docs/product/roadmap.md
git commit -m "docs: mark the package-manager toggle as shipped"
git push -u origin feat/package-manager-toggle
gh pr create --title "feat(site): a package-manager toggle that swaps the install command in place" --body "..."
```

The PR body links the verification matrix from Task 1 and states which manager versions were actually tested. A reviewer should not have to take the commands on trust.
