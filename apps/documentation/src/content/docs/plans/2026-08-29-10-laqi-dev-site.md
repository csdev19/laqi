---
title: "Plan 10 — laqi.dev: the public site, first slice"
---

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the first slice of laqi.dev: a hand-built landing page matching five approved mockups pixel-for-pixel, plus a themed docs section at `/docs/*`, deployed to Cloudflare on every merge to `main`.

**Architecture:** A new Astro app, `apps/site`, in the existing Bun/Turborepo monorepo. The landing page (`/`) is a plain Astro page outside Starlight's content routing, assembled from five section components. Docs content lives under `src/content/docs/docs/**` — nesting one level deeper than Starlight's default so its routes land at `/docs/*` instead of the site root, without touching Astro's global `base` (which would move the landing page too). A new `packages/tokens` package is the single source of truth for the color/font design tokens already shipped in the CLI's control panel (`packages/editor`); both the panel and the site import it, closing the "same hex, same names, maintained once" gap the site design doc flagged as unresolved.

**Tech Stack:** Astro 5 + `@astrojs/starlight` (same versions as `apps/documentation`), self-hosted `@fontsource/source-serif-4` and `@fontsource/jetbrains-mono` (no Google Fonts CDN), Bun workspaces, Cloudflare Pages, Vitest for the one package that has real logic (`packages/tokens`'s guard test).

**Spec:** `apps/documentation/src/content/docs/design/public-site.md` — the original external site spec plus the reconciliation delta and the 2026-08-29 rulings recorded at its top. This plan implements Rulings 2–4, and the delta's "install command" (§ install-string correction), "shared tokens" (§ token mechanism), and "second deployable, not tag-driven" (§ deploy timing) sections in full. It ships 3 docs pages, not the delta's suggested six — see the note under "Scope" below — and explicitly defers the `llms.txt`/MCP agent-docs section to a later plan.

## Global Constraints

- **English everywhere in code, comments, commits, and the landing page's copy** (ADR-0009, and the user's standing instruction). The Spanish Starlight locale under `es/` is the one deliberate, structural exception — not a language slip.
- **`apps/site` never cuts a CLI release.** Add it to `release-please-config.json`'s `exclude-paths`, same treatment as `apps/documentation` and `examples`.
- **`apps/documentation` (55 internal pages: ADRs, plans, design docs) must never be linked from or reachable via `apps/site`.** Two fully separate Astro projects; nothing in `apps/site` imports from or references `apps/documentation`.
- **Design tokens are not duplicated.** Every hex code and font stack lives in exactly one file (`packages/tokens/src/tokens.css`); `packages/editor` and `apps/site` both import it. Never hardcode a color literal that already has a token name.
- **No remote font loading.** Fonts are self-hosted via `@fontsource/*` packages bundled into the build, matching the panel's own "the panel has to look the same with the wifi off" rule extended to the site.
- **Install string is `npm i -g laqi`** — no `@beta` suffix. v2 shipped as plain `2.0.0` (PR #31); the beta dist-tag path no longer exists.
- **The version badge reads from `apps/cli/package.json` at build time, never hardcoded.** One place changes it on every release.
- **Deploy on merge to `main`, never on a version tag.** A typo fix on the landing page must reach production without cutting a CLI release.
- **Content lint (bans "Laqi"/"LAQI" outside code spans) and a broken-link check run in CI from the first commit that adds content** — not retrofitted after 50 pages exist.
- **Follow this repo's existing conventions:** Bun workspace package layout (see `apps/documentation` as the sibling app to fork structure from), `oxlint`/`oxfmt` via `bun run check:ci`, Conventional Commit messages, PR-only workflow — no local merges, no direct pushes to `main`.
- **Out of scope for this plan** (deferred by this session's Ruling 2): the `LaqiTransport`/`MemoryTransport` extraction, the live interactive demo island, publishing `@laqi/editor` to npm. Every "demo" slot on the landing page is a static placeholder (image/video poster with a caption), never a running panel.
- **Scope note on page count:** the reconciled spec's "suggested first slice" sketched "the landing and the six core pages." This plan ships the landing page plus 3 docs pages (`docs/`, `docs/installation`, `docs/concepts/resolution-layers`) — enough to prove the routing, i18n, and theming work end to end, not the full six-page set. Reaching six is mechanical repetition of Task 2's pattern once the remaining pages' real content is written; inventing three more stub pages here would add bulk without value. Call this out explicitly in the PR rather than let it read as complete.

---

## File structure

```
packages/tokens/
├── package.json
└── src/
    ├── tokens.css          # the single source of truth for colors + fonts
    └── tokens.test.ts      # guards the exact hex values against drift

apps/site/
├── package.json
├── astro.config.mjs
├── tsconfig.json
├── content.config.ts
├── public/
│   └── favicon.svg          # copied from packages/editor/public/favicon.svg
├── src/
│   ├── styles/
│   │   └── global.css       # fonts + tokens + Starlight theme overrides
│   ├── components/
│   │   ├── SiteNav.astro
│   │   ├── InstallCommand.astro
│   │   ├── Hero.astro
│   │   ├── DemoPlaceholder.astro
│   │   ├── QuickStart.astro
│   │   ├── ResolutionLayers.astro
│   │   └── FeatureGrid.astro
│   ├── lib/
│   │   └── version.ts       # reads apps/cli/package.json's version at build time
│   ├── pages/
│   │   └── index.astro      # assembles the landing page from the components above
│   └── content/
│       └── docs/
│           └── docs/
│               ├── index.md
│               ├── installation.md
│               └── concepts/
│                   └── resolution-layers.md
│           └── es/
│               └── docs/
│                   └── index.md   # Spanish stub — full Spanish copy is a later slice
```

---

## Task 1: Extract shared design tokens into `packages/tokens`

**Files:**

- Create: `packages/tokens/package.json`
- Create: `packages/tokens/src/tokens.css`
- Create: `packages/tokens/src/tokens.test.ts`
- Modify: `packages/editor/src/styles.css:1-31`
- Modify: `packages/editor/package.json`

**Interfaces:**

- Produces: `@laqi/tokens/tokens.css` — a CSS file exporting the `:root` custom properties `--bg`, `--panel`, `--panel2`, `--line`, `--line2`, `--fg`, `--dim`, `--dim2`, `--vio`, `--viol`, `--mag`, `--magl`, `--mint`, `--red`, `--warn`, `--palev`, `--palem`, `--serif`, `--mono`. Every later task in this plan consumes these exact names.

- [ ] **Step 1: Write the failing test**

```ts
// packages/tokens/src/tokens.test.ts
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf-8')

// Every consumer (the CLI's control panel, the public site) trusts these
// exact values. A change here is a design decision, never a typo — this
// test exists so one never slips in by accident.
describe('design tokens', () => {
  const colors: Array<[string, string]> = [
    ['--bg', '#0b0a0f'],
    ['--panel', '#121019'],
    ['--panel2', '#171522'],
    ['--line', '#241f35'],
    ['--line2', '#332a4a'],
    ['--fg', '#eae7f2'],
    ['--dim', '#8e88a8'],
    ['--dim2', '#5c5678'],
    ['--vio', '#7a00ff'],
    ['--viol', '#a366ff'],
    ['--mag', '#ff00a0'],
    ['--magl', '#ff7ac8'],
    ['--mint', '#00ffc2'],
    ['--red', '#ff0058'],
    ['--warn', '#ffb020'],
    ['--palev', '#c9a6ff'],
    ['--palem', '#7fefd8'],
  ]

  it.each(colors)('%s is %s', (name, value) => {
    const re = new RegExp(`${name}:\\s*${value};`)
    expect(css).toMatch(re)
  })

  it('declares the serif display font with Source Serif 4 first', () => {
    expect(css).toContain("--serif: 'Source Serif 4', 'Source Serif Pro', Georgia")
  })

  it('declares the mono font with JetBrains Mono first', () => {
    expect(css).toContain("--mono: 'JetBrains Mono', ui-monospace")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run packages/tokens -t 'design tokens'`
Expected: FAIL — `packages/tokens/src/tokens.css` does not exist yet (`ENOENT`).

- [ ] **Step 3: Write the token file and package manifest**

```css
/* packages/tokens/src/tokens.css */
/*
 * The single source of truth for laqi's color and font tokens. Two
 * consumers import this file: the CLI's control panel
 * (packages/editor) and the public site (apps/site). Change a value
 * here — both update. Never redeclare one of these hex codes anywhere
 * else in either project.
 */
:root {
  --bg: #0b0a0f;
  --panel: #121019;
  --panel2: #171522;
  --line: #241f35;
  --line2: #332a4a;
  --fg: #eae7f2;
  --dim: #8e88a8;
  --dim2: #5c5678;

  --vio: #7a00ff;
  --viol: #a366ff;
  --mag: #ff00a0;
  --magl: #ff7ac8;
  --mint: #00ffc2;
  --red: #ff0058;
  --warn: #ffb020;
  --palev: #c9a6ff;
  --palem: #7fefd8;

  --serif: 'Source Serif 4', 'Source Serif Pro', Georgia, 'Times New Roman', serif;
  --mono: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
```

```json
// packages/tokens/package.json
{
  "name": "@laqi/tokens",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "exports": {
    "./tokens.css": "./src/tokens.css"
  },
  "devDependencies": {
    "vitest": "catalog:"
  }
}
```

Note: `"vitest": "catalog:"` follows this monorepo's existing catalog pattern (see the root `package.json`'s `workspaces.catalog`) — if `vitest` is not yet in the catalog, add `"vitest": "^2.1.0"` to `workspaces.catalog` in the root `package.json` to match the version already declared as a root `devDependency`, then reference it here as `catalog:`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun install && bunx vitest run packages/tokens`
Expected: PASS — all cases in `describe('design tokens')` green.

- [ ] **Step 5: Point the panel at the shared tokens instead of its own copy**

```css
/* packages/editor/src/styles.css — replace lines 1-31 with: */
/*
 * Colors and fonts come from @laqi/tokens — the same file the public
 * site imports, so the panel and laqi.dev never drift apart. Only
 * this package's own layout tokens (row height, log panel width)
 * stay local, because nothing outside the panel needs them.
 */
@import '@laqi/tokens/tokens.css';

:root {
  --rpy: 10px;
  --log-w: 426px;
}
```

```json
// packages/editor/package.json — add to "dependencies"
"@laqi/tokens": "workspace:*",
```

- [ ] **Step 6: Verify the panel still resolves every token correctly**

Run: `bun install && bun run build --filter=@laqi/editor && grep -c -- '--vio: #7a00ff' packages/editor/dist/assets/*.css`
Expected: the build succeeds and the count is at least 1 — Vite inlined the imported CSS custom property into the built stylesheet exactly as before.

Run: `bunx vitest run packages/editor`
Expected: every existing editor test still passes — nothing about component behavior changed, only where the color values are declared.

- [ ] **Step 7: Commit**

```bash
git add packages/tokens packages/editor/src/styles.css packages/editor/package.json package.json bun.lock
git commit -m "refactor: extract shared design tokens into @laqi/tokens"
```

---

## Task 2: Scaffold `apps/site` — Astro + Starlight, routing, i18n

**Files:**

- Create: `apps/site/package.json`
- Create: `apps/site/astro.config.mjs`
- Create: `apps/site/tsconfig.json`
- Create: `apps/site/content.config.ts`
- Create: `apps/site/public/favicon.svg`
- Create: `apps/site/src/styles/global.css`
- Create: `apps/site/src/pages/index.astro` (placeholder body for this task — real content in Task 7)
- Create: `apps/site/src/content/docs/docs/index.md`
- Create: `apps/site/src/content/docs/docs/installation.md`
- Create: `apps/site/src/content/docs/es/docs/index.md`
- Modify: `release-please-config.json`

**Interfaces:**

- Consumes: `@laqi/tokens/tokens.css` (Task 1).
- Produces: the route structure every later task builds into — `/` (landing, English only this slice), `/docs/*` (English docs), `/es/docs/*` (Spanish docs). Later tasks add components under `src/components/` and assemble them into `src/pages/index.astro`; this task's placeholder version is fully replaced by Task 7, not extended.

- [ ] **Step 1: Create the package manifest**

```json
// apps/site/package.json
{
  "name": "@laqi/site",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "astro dev",
    "start": "astro dev",
    "build": "astro build",
    "preview": "astro preview",
    "astro": "astro",
    "check-types": "astro check"
  },
  "dependencies": {
    "@astrojs/starlight": "^0.37.6",
    "@laqi/tokens": "workspace:*",
    "astro": "^5.6.1",
    "sharp": "^0.34.2"
  }
}
```

- [ ] **Step 2: Install Astro's dependencies and add the self-hosted fonts**

Run, from the repo root:

```
bun install
bun add @fontsource/source-serif-4 @fontsource/jetbrains-mono --filter=@laqi/site
```

Using `bun add` (rather than a hand-typed version number in `package.json`) resolves whatever the current published version of each font package actually is — do not guess a version.

- [ ] **Step 3: Write `tsconfig.json`**

```json
// apps/site/tsconfig.json
{
  "extends": "astro/tsconfigs/strict",
  "include": [".astro/types.d.ts", "**/*"],
  "exclude": ["dist"]
}
```

- [ ] **Step 4: Write the content collection config**

```ts
// apps/site/content.config.ts
import { defineCollection } from 'astro:content'
import { docsLoader } from '@astrojs/starlight/loaders'
import { docsSchema } from '@astrojs/starlight/schema'

export const collections = {
  docs: defineCollection({ loader: docsLoader(), schema: docsSchema() }),
}
```

- [ ] **Step 5: Write `astro.config.mjs`, with docs nested one level under `docs/`**

```js
// apps/site/astro.config.mjs
// @ts-check
import { defineConfig } from 'astro/config'
import starlight from '@astrojs/starlight'

// The landing page lives at `/`, hand-built in src/pages/index.astro,
// entirely outside Starlight's own routing. Docs need to land at
// `/docs/*` without moving the landing page too — Astro's global `base`
// option would move everything, so instead every docs file sits one
// folder deeper than Starlight's default (src/content/docs/docs/... —
// Starlight routes a file at the path relative to src/content/docs/,
// so a file at docs/installation.md gets the slug "docs/installation"
// and therefore the route /docs/installation/).
export default defineConfig({
  integrations: [
    starlight({
      title: 'laqi',
      description: "Mock any API, flip any response, in one click.",
      defaultLocale: 'en',
      locales: {
        root: { label: 'English', lang: 'en' },
        es: { label: 'Español', lang: 'es' },
      },
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/csdev19/laqi' }],
      customCss: ['./src/styles/global.css'],
      sidebar: [
        {
          label: 'Getting Started',
          items: [{ slug: 'docs' }, { slug: 'docs/installation' }],
        },
        {
          label: 'Concepts',
          items: [{ slug: 'docs/concepts/resolution-layers' }],
        },
      ],
    }),
  ],
})
```

- [ ] **Step 6: Copy the brand favicon**

```bash
cp packages/editor/public/favicon.svg apps/site/public/favicon.svg
```

- [ ] **Step 7: Write the global stylesheet — fonts, tokens, Starlight theme overrides**

Before writing the Starlight overrides, confirm the exact CSS custom property names this installed version of Starlight exposes (names can shift between versions, and a wrong name silently no-ops instead of erroring):

Run: `grep -rho -- '--sl-[a-z-]*' node_modules/@astrojs/starlight/style/props.css | sort -u`

Use exactly the names that command prints. The block below uses the names current as of Starlight 0.37 — verify against the grep output and adjust any that differ before committing:

```css
/* apps/site/src/styles/global.css */
@import '@fontsource/source-serif-4/400.css';
@import '@fontsource/source-serif-4/600.css';
@import '@fontsource/jetbrains-mono/400.css';
@import '@fontsource/jetbrains-mono/500.css';
@import '@laqi/tokens/tokens.css';

/* Starlight's own theme hooks — remapped onto our tokens so the docs
   section (/docs/*) reads as the same product as the landing page and
   the CLI's control panel, not a different, generic doc site. */
:root {
  --sl-color-bg: var(--bg);
  --sl-color-bg-nav: var(--panel);
  --sl-color-bg-sidebar: var(--bg);
  --sl-color-text: var(--fg);
  --sl-color-text-accent: var(--viol);
  --sl-color-accent: var(--vio);
  --sl-color-hairline: var(--line);
  --sl-color-hairline-light: var(--line2);
  --sl-font: var(--mono);
  --sl-font-mono: var(--mono);
}

/* Prose headings inside docs content use the display serif — Starlight's
   own default keeps everything on --sl-font (mono), which is right for
   labels and code but not for a page's own H1/H2/H3. */
.sl-markdown-content h1,
.sl-markdown-content h2,
.sl-markdown-content h3 {
  font-family: var(--serif);
}

body {
  background: var(--bg);
  color: var(--fg);
}
```

- [ ] **Step 8: Write a placeholder landing page (real content lands in Task 7)**

```astro
---
// apps/site/src/pages/index.astro
import '../styles/global.css'
---
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <title>laqi — mock any API, flip any response, in one click</title>
  </head>
  <body>
    <main>
      <p>laqi.dev — scaffold in progress.</p>
      <a href="/docs/">Docs</a>
    </main>
  </body>
</html>
```

- [ ] **Step 9: Write the first English docs pages**

```md
<!-- apps/site/src/content/docs/docs/index.md -->
---
title: Docs
description: laqi documentation.
---

Start with [Installation](/docs/installation/).
```

```md
<!-- apps/site/src/content/docs/docs/installation.md -->
---
title: Installation
description: Install laqi.
---

```

npm i -g laqi

```

That installs the `laqi` binary globally. Run `laqi start` from inside a
project with mock files to serve them.
```

```md
<!-- apps/site/src/content/docs/docs/concepts/resolution-layers.md -->
---
title: Resolution layers
description: The four layers that decide every response.
---

Every request laqi answers passes through four layers: `header`, `state`,
`scenario`, and `default`. The first one that has an opinion wins.

## Order of precedence

| # | Layer | Set by | Persists |
| - | - | - | - |
| 1 | `header` | `X-Laqi-Response` on the request | no |
| 2 | `state` | a click in the control panel | yes |
| 3 | `scenario` | the active scenario, if it covers this route | yes |
| 4 | `default` | the `default` key in the mock file | — |
```

- [ ] **Step 10: Write the Spanish locale stub**

```md
<!-- apps/site/src/content/docs/es/docs/index.md -->
---
title: Documentación
description: Documentación de laqi.
---

Esta sección está en construcción. Mientras tanto, consulta la
[documentación en inglés](/docs/).
```

- [ ] **Step 11: Exclude the site from release-please's version line**

```json
// release-please-config.json — packages["."]  "exclude-paths"
"exclude-paths": ["apps/documentation", "apps/site", "examples"],
```

- [ ] **Step 12: Build and verify every expected route exists**

Run:

```
bun install
bun run build --filter=@laqi/site
find apps/site/dist -name index.html | sort
```

Expected output includes, at minimum:

```
apps/site/dist/docs/concepts/resolution-layers/index.html
apps/site/dist/docs/index.html
apps/site/dist/docs/installation/index.html
apps/site/dist/es/docs/index.html
apps/site/dist/index.html
```

If `/docs/*` routes instead land at the site root, or `/es/docs/*` does not exist, the nesting or locale config from Step 5 is wrong — fix it before continuing; every later task depends on this route structure being correct.

- [ ] **Step 13: Commit**

```bash
git add apps/site release-please-config.json package.json bun.lock
git commit -m "feat(site): scaffold apps/site — Astro + Starlight, /docs routing, i18n"
```

---

## Task 3: `InstallCommand` and `SiteNav` components — the version badge and nav bar

**Files:**

- Create: `apps/site/src/lib/version.ts`
- Create: `apps/site/src/lib/version.test.ts`
- Create: `apps/site/src/components/InstallCommand.astro`
- Create: `apps/site/src/components/SiteNav.astro`

**Interfaces:**

- Produces: `getLaqiVersion(): string` — reads `apps/cli/package.json`'s `version` field. Only `SiteNav`'s version badge calls it in this slice (mockup 1 shows the version badge in the nav bar, not inside the install-command box); `InstallCommand` stays a static `npm i -g laqi` string with no version interpolation. Task 4 (`Hero`) renders both components together.

- [ ] **Step 1: Write the failing test**

```ts
// apps/site/src/lib/version.test.ts
import { describe, expect, it } from 'vitest'
import { getLaqiVersion } from './version'

describe('getLaqiVersion', () => {
  it('reads the version from apps/cli/package.json', () => {
    // apps/cli/package.json is 2.0.0 as of this writing (PR #31, the
    // beta line was dropped). If that version changes, this assertion
    // is meant to change with it — the point of reading from one file
    // is that this is the only place that has to.
    expect(getLaqiVersion()).toBe('2.0.0')
  })

  it('returns a bare semver string with no leading v or @beta suffix', () => {
    expect(getLaqiVersion()).toMatch(/^\d+\.\d+\.\d+$/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run apps/site/src/lib/version.test.ts`
Expected: FAIL — `./version` has no exported member `getLaqiVersion` (module not found).

- [ ] **Step 3: Implement**

```ts
// apps/site/src/lib/version.ts
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// The version badge in the nav and the install command both need this.
// Reading it from apps/cli/package.json at build time — rather than
// hardcoding it here — means a release never requires touching the site.
const cliPackageJsonUrl = new URL('../../../cli/package.json', import.meta.url)

export function getLaqiVersion(): string {
  const raw = readFileSync(fileURLToPath(cliPackageJsonUrl), 'utf-8')
  const pkg = JSON.parse(raw) as { version: string }
  return pkg.version
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run apps/site/src/lib/version.test.ts`
Expected: PASS, both cases.

- [ ] **Step 5: Build the install command component**

```astro
---
// apps/site/src/components/InstallCommand.astro
---
<div class="install-command">
  <span class="prompt">$</span>
  <code>npm i -g laqi</code>
  <button type="button" class="copy" data-copy="npm i -g laqi">copy</button>
</div>

<script>
  for (const button of document.querySelectorAll<HTMLButtonElement>('.install-command .copy')) {
    button.addEventListener('click', () => {
      const text = button.dataset.copy ?? ''
      navigator.clipboard.writeText(text)
      const original = button.textContent
      button.textContent = 'copied'
      setTimeout(() => {
        button.textContent = original
      }, 1500)
    })
  }
</script>

<style>
  .install-command {
    display: inline-flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.85rem 1.25rem;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 6px;
    font-family: var(--mono);
  }
  .prompt {
    color: var(--dim);
  }
  code {
    color: var(--fg);
  }
  .copy {
    background: none;
    border: none;
    color: var(--mint);
    font-family: var(--mono);
    cursor: pointer;
    padding: 0;
  }
  .copy:hover {
    color: var(--palem);
  }
</style>
```

- [ ] **Step 6: Build the nav bar component**

```astro
---
// apps/site/src/components/SiteNav.astro
import { getLaqiVersion } from '../lib/version'

const version = getLaqiVersion()
---
<header class="site-nav">
  <a href="/" class="brand">
    <img src="/favicon.svg" alt="" width="20" height="20" />
    <span>laqi</span>
  </a>
  <span class="version-badge">v{version}</span>
  <nav>
    <a href="/docs/">Docs</a>
    <a href="/docs/installation/">Quick start</a>
    <a href="/docs/concepts/resolution-layers/">Concepts</a>
    <a href="https://github.com/csdev19/laqi/tree/main/examples">Examples</a>
    <a href="https://github.com/csdev19/laqi">GitHub</a>
  </nav>
  <a href="/docs/" class="search">Search docs <kbd>⌘K</kbd></a>
</header>

<style>
  .site-nav {
    display: flex;
    align-items: center;
    gap: 1.5rem;
    padding: 1rem 2rem;
    border-bottom: 1px solid var(--line);
    font-family: var(--mono);
    color: var(--fg);
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    color: var(--fg);
    text-decoration: none;
    font-weight: 600;
  }
  .version-badge {
    padding: 0.15rem 0.5rem;
    border: 1px solid var(--line2);
    border-radius: 4px;
    color: var(--dim);
    font-size: 0.85rem;
  }
  nav {
    display: flex;
    gap: 1.25rem;
    margin-left: 1rem;
  }
  nav a {
    color: var(--dim);
    text-decoration: none;
  }
  nav a:hover {
    color: var(--fg);
  }
  .search {
    margin-left: auto;
    padding: 0.4rem 0.75rem;
    border: 1px solid var(--line);
    border-radius: 6px;
    color: var(--dim);
    text-decoration: none;
    font-size: 0.85rem;
  }
</style>
```

- [ ] **Step 7: Commit**

```bash
git add apps/site/src/lib apps/site/src/components/InstallCommand.astro apps/site/src/components/SiteNav.astro
git commit -m "feat(site): version-aware install command and nav bar"
```

---

## Task 4: `DemoPlaceholder` and `Hero` — mockups 1 and 2

**Files:**

- Create: `apps/site/src/components/DemoPlaceholder.astro`
- Create: `apps/site/src/components/Hero.astro`

**Interfaces:**

- Consumes: `InstallCommand.astro`, `SiteNav.astro` (Task 3).
- Produces: `DemoPlaceholder` accepts `caption: string` and an optional `chrome: string` (the browser-chrome address-bar text, e.g. `127.0.0.1:8000/__laqi`) — Task 6's feature-grid placeholders reuse this same component.

- [ ] **Step 1: Build the demo placeholder**

Matches mockup 2's static, non-interactive placeholder box — a dashed border, an optional browser-chrome strip, a centered icon, and a caption. No JavaScript, no live panel; this stands in for a video poster or screenshot that gets dropped in later.

```astro
---
// apps/site/src/components/DemoPlaceholder.astro
interface Props {
  caption: string
  chrome?: string
}
const { caption, chrome } = Astro.props as Props
---
<figure class="demo-placeholder">
  {chrome && (
    <div class="chrome">
      <span class="dot"></span><span class="dot"></span><span class="dot"></span>
      <span class="address">{chrome}</span>
    </div>
  )}
  <div class="drop-zone">
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="M21 15l-5-5L5 21" />
    </svg>
    <p>{caption}</p>
    <a href="#" class="browse">or browse files</a>
  </div>
  <figcaption></figcaption>
</figure>

<style>
  .demo-placeholder {
    margin: 0;
    border: 1px dashed var(--line2);
    border-radius: 8px;
    overflow: hidden;
    background: var(--panel);
  }
  .chrome {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.6rem 0.9rem;
    border-bottom: 1px solid var(--line);
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--line2);
  }
  .address {
    margin-left: 0.75rem;
    font-family: var(--mono);
    font-size: 0.8rem;
    color: var(--dim);
  }
  .drop-zone {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
    padding: 4rem 1.5rem;
    color: var(--dim);
    text-align: center;
  }
  .drop-zone p {
    max-width: 32ch;
    margin: 0;
    font-family: var(--mono);
    font-size: 0.9rem;
  }
  .browse {
    color: var(--viol);
    font-size: 0.85rem;
  }
</style>
```

- [ ] **Step 2: Build the hero section**

Matches mockup 1's full hero: eyebrow line, serif headline, sub-paragraph, install command + two CTAs, four badges, then mockup 2's placeholder underneath.

```astro
---
// apps/site/src/components/Hero.astro
import InstallCommand from './InstallCommand.astro'
import DemoPlaceholder from './DemoPlaceholder.astro'
---
<section class="hero">
  <p class="eyebrow">llulla + chasqui · the false messenger</p>
  <h1>Mock any API,<br />flip any response,<br />in one click.</h1>
  <p class="lede">
    laqi is a local mock server with a control panel. Point your app at it
    and put your API into any state — empty, slow, unauthorized, on
    fire — without touching a line of code.
  </p>
  <div class="cta-row">
    <InstallCommand />
    <a href="/docs/installation/" class="btn-primary">Quick start</a>
    <a href="/docs/" class="btn-secondary">Read the docs</a>
  </div>
  <p class="badges">
    <span>no account</span>
    <span>no cloud</span>
    <span>no code changes</span>
    <span>one binary</span>
  </p>
  <DemoPlaceholder
    chrome="127.0.0.1:8000/__laqi"
    caption="Drop the panel demo video poster (or a screen recording still) — 16:9"
  />
</section>

<style>
  .hero {
    max-width: 56rem;
    margin: 0 auto;
    padding: 6rem 1.5rem 4rem;
    text-align: center;
    background: radial-gradient(ellipse at top, color-mix(in srgb, var(--vio) 12%, transparent), transparent 60%);
  }
  .eyebrow {
    font-family: var(--mono);
    font-size: 0.8rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--viol);
    margin-bottom: 1.5rem;
  }
  h1 {
    font-family: var(--serif);
    font-size: clamp(2.5rem, 6vw, 4rem);
    line-height: 1.15;
    color: var(--fg);
    margin: 0 0 1.5rem;
  }
  .lede {
    max-width: 40rem;
    margin: 0 auto 2rem;
    color: var(--dim);
    font-size: 1.1rem;
    line-height: 1.6;
  }
  .cta-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: 1rem;
    margin-bottom: 1.5rem;
  }
  .btn-primary {
    padding: 0.85rem 1.5rem;
    background: var(--vio);
    color: #fff;
    border-radius: 6px;
    text-decoration: none;
    font-family: var(--mono);
    font-weight: 600;
  }
  .btn-secondary {
    padding: 0.85rem 1.5rem;
    border: 1px solid var(--line2);
    color: var(--fg);
    border-radius: 6px;
    text-decoration: none;
    font-family: var(--mono);
  }
  .badges {
    display: flex;
    justify-content: center;
    gap: 1.5rem;
    font-family: var(--mono);
    font-size: 0.8rem;
    color: var(--dim2);
    margin-bottom: 3rem;
  }
</style>
```

- [ ] **Step 3: Build and check the hero renders**

Run:

```
bun run build --filter=@laqi/site
grep -c "Mock any API" apps/site/dist/index.html
```

(Task 2's placeholder `index.astro` doesn't use `Hero` yet — this check confirms the component compiles cleanly on its own; wiring it into the actual page is Task 7.) Instead:

Run: `bunx astro check --root apps/site`
Expected: no type errors from the new components.

- [ ] **Step 4: Commit**

```bash
git add apps/site/src/components/DemoPlaceholder.astro apps/site/src/components/Hero.astro
git commit -m "feat(site): hero section and reusable demo placeholder"
```

---

## Task 5: `QuickStart` and `ResolutionLayers` — mockup 3

**Files:**

- Create: `apps/site/src/components/QuickStart.astro`
- Create: `apps/site/src/components/ResolutionLayers.astro`

**Interfaces:**

- Consumes: nothing from prior tasks (self-contained, static content).
- Produces: both components render into `src/pages/index.astro` in Task 7.

- [ ] **Step 1: Build the three-step quick start**

```astro
---
// apps/site/src/components/QuickStart.astro
const steps = [
  {
    n: '01',
    title: 'Describe an endpoint',
    body: 'A JSON file in ./laqi/. One key per route, a named response for each state you care about.',
    code: `{
  "GET /todos": {
    "default": "ok",
    "responses": {
      "ok": { "body": [{ "id": 1 }] },
      "empty": { "body": [] },
      "slow": { "delay": 2400, "body": [] },
      "error": { "status": 500 }
    }
  }
}`,
  },
  {
    n: '02',
    title: 'Start it',
    body: 'One command. The panel opens with it, and the folder is watched from then on.',
    code: `$ laqi start

⚡ laqi 2.0.0
serving   127.0.0.1:8000
panel     127.0.0.1:8000/__laqi
watching  ./laqi/  7 endpoints`,
  },
  {
    n: '03',
    title: 'Point your app at it',
    body: 'Change one base URL. Everything else — states, errors, latency — now happens in the panel.',
    code: `// .env.local
VITE_API_URL=http://127.0.0.1:8000

// or per-request, no state change:
fetch("/todos", {
  headers: { "X-Laqi-Response": "error" }
})`,
  },
]
---
<section class="quick-start">
  <p class="eyebrow">quick start</p>
  <h2>Three steps, about a minute</h2>
  <div class="steps">
    {steps.map((step) => (
      <div class="step">
        <p class="n">{step.n}</p>
        <h3>{step.title}</h3>
        <p class="body">{step.body}</p>
        <pre><code>{step.code}</code></pre>
      </div>
    ))}
  </div>
</section>

<style>
  .quick-start {
    max-width: 72rem;
    margin: 0 auto;
    padding: 4rem 1.5rem;
  }
  .eyebrow {
    font-family: var(--mono);
    font-size: 0.8rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--viol);
    margin-bottom: 0.75rem;
  }
  h2 {
    font-family: var(--serif);
    font-size: 2.25rem;
    color: var(--fg);
    margin: 0 0 2.5rem;
  }
  .steps {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr));
    gap: 2rem;
  }
  .step .n {
    font-family: var(--mono);
    color: var(--vio);
    font-weight: 600;
    margin: 0 0 0.5rem;
  }
  .step h3 {
    color: var(--fg);
    margin: 0 0 0.5rem;
  }
  .step .body {
    color: var(--dim);
    font-size: 0.95rem;
    margin: 0 0 1rem;
  }
  .step pre {
    margin: 0;
    padding: 1rem;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 6px;
    overflow-x: auto;
  }
  .step code {
    font-family: var(--mono);
    font-size: 0.8rem;
    color: var(--fg);
    white-space: pre;
  }
</style>
```

- [ ] **Step 2: Build the resolution-layers panel**

```astro
---
// apps/site/src/components/ResolutionLayers.astro
const layers = [
  { name: 'header', color: 'var(--mint)', desc: 'X-Laqi-Response on one request', meta: 'changes nothing' },
  { name: 'state', color: 'var(--mag)', desc: 'you clicked a chip in the panel', meta: 'persists' },
  { name: 'scenario', color: 'var(--vio)', desc: 'offline, logged-out, empty-state', meta: 'one at a time' },
  { name: 'default', color: 'var(--line2)', desc: 'whatever the file says', meta: 'the baseline' },
]
---
<section class="resolution-layers">
  <div class="prose">
    <p class="eyebrow">the one concept</p>
    <h2>Four layers decide every response</h2>
    <p>
      A per-request header beats a panel flip, which beats an active
      scenario, which beats the file's default. laqi always tells you
      which one won — in the panel, in the terminal, and in an
      <code>X-Laqi-Resolved</code> header on every response.
    </p>
    <p>That is the whole mental model. There is nothing else to learn.</p>
    <a href="/docs/concepts/resolution-layers/" class="link">Concepts → Resolution →</a>
  </div>
  <ol class="layers">
    {layers.map((layer, i) => (
      <li style={`border-color: ${layer.color}`}>
        <span class="index">{i + 1}</span>
        <div>
          <p class="name" style={`color: ${layer.color}`}>{layer.name}</p>
          <p class="desc">{layer.desc} · {layer.meta}</p>
        </div>
      </li>
    ))}
  </ol>
</section>

<style>
  .resolution-layers {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 3rem;
    max-width: 72rem;
    margin: 0 auto;
    padding: 4rem 1.5rem;
    background: var(--panel2);
  }
  .eyebrow {
    font-family: var(--mono);
    font-size: 0.8rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--viol);
    margin-bottom: 0.75rem;
  }
  h2 {
    font-family: var(--serif);
    font-size: 2rem;
    color: var(--fg);
    margin: 0 0 1.25rem;
  }
  .prose p {
    color: var(--dim);
    line-height: 1.6;
  }
  .prose code {
    font-family: var(--mono);
    color: var(--fg);
  }
  .link {
    display: inline-block;
    margin-top: 1rem;
    font-family: var(--mono);
    color: var(--mint);
    text-decoration: none;
  }
  .layers {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .layers li {
    display: flex;
    align-items: baseline;
    gap: 1rem;
    padding: 1rem 1.25rem;
    background: var(--panel);
    border: 1px solid;
    border-radius: 6px;
  }
  .index {
    font-family: var(--mono);
    color: var(--dim2);
  }
  .name {
    font-family: var(--mono);
    font-weight: 600;
    margin: 0 0 0.25rem;
  }
  .desc {
    margin: 0;
    color: var(--dim);
    font-size: 0.85rem;
  }
</style>
```

- [ ] **Step 3: Verify no type errors**

Run: `bunx astro check --root apps/site`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add apps/site/src/components/QuickStart.astro apps/site/src/components/ResolutionLayers.astro
git commit -m "feat(site): quick-start steps and resolution-layers panel"
```

---

## Task 6: `FeatureGrid` — mockup 4

**Files:**

- Create: `apps/site/src/components/FeatureGrid.astro`

**Interfaces:**

- Consumes: `DemoPlaceholder.astro` (Task 4).

- [ ] **Step 1: Build the feature grid**

```astro
---
// apps/site/src/components/FeatureGrid.astro
import DemoPlaceholder from './DemoPlaceholder.astro'

const features = [
  { kicker: 'one click', color: 'var(--mint)', title: 'Flip a response', body: "Every response is a chip in the list. No dropdown, no rebuild, no restart. The next request gets the new one." },
  { kicker: 'scenarios', color: 'var(--vio)', title: 'Move the whole API at once', body: 'Name a set of overrides offline and put your app in it with one click. The demo move.' },
  { kicker: 'live log', color: 'var(--mint)', title: 'See every request land', body: 'Status, timing, and which layer decided the response. Requests that match nothing are impossible to miss.' },
  { kicker: 'latency', color: 'var(--mag)', title: 'Slow things down on purpose', body: 'A delay on any response. Build the skeleton state you can never reproduce locally.' },
  { kicker: 'tunnel', color: 'var(--mag)', title: 'Share it for ten minutes', body: 'One button gives you a public URL and a token, for a teammate or a real phone. Off by default, always.' },
  { kicker: 'plain files', color: 'var(--dim)', title: 'It is just JSON in your repo', body: 'Diffable, reviewable, committed. Edit in your editor or in the panel — both write the same file.' },
]
---
<section class="feature-grid">
  <p class="eyebrow">what you get</p>
  <h2>Built for the fifty times a day you ask "what if this fails?"</h2>
  <div class="grid">
    {features.map((f) => (
      <div class="card">
        <p class="kicker" style={`color: ${f.color}`}>{f.kicker}</p>
        <h3>{f.title}</h3>
        <p class="body">{f.body}</p>
      </div>
    ))}
  </div>
  <div class="demos">
    <DemoPlaceholder caption="Demo: activating the offline scenario" />
    <DemoPlaceholder caption="Demo: ⌘K palette, typing 'todos error'" />
  </div>
</section>

<style>
  .feature-grid {
    max-width: 72rem;
    margin: 0 auto;
    padding: 4rem 1.5rem;
  }
  .eyebrow {
    font-family: var(--mono);
    font-size: 0.8rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--viol);
    margin-bottom: 0.75rem;
  }
  h2 {
    font-family: var(--serif);
    font-size: 2rem;
    color: var(--fg);
    max-width: 40rem;
    margin: 0 0 2.5rem;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
    gap: 1.25rem;
    margin-bottom: 3rem;
  }
  .card {
    padding: 1.5rem;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 8px;
  }
  .kicker {
    font-family: var(--mono);
    font-size: 0.75rem;
    text-transform: lowercase;
    margin: 0 0 0.75rem;
  }
  .card h3 {
    font-family: var(--serif);
    color: var(--fg);
    margin: 0 0 0.5rem;
  }
  .card .body {
    color: var(--dim);
    font-size: 0.9rem;
    line-height: 1.5;
    margin: 0;
  }
  .demos {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1.5rem;
  }
</style>
```

- [ ] **Step 2: Verify no type errors**

Run: `bunx astro check --root apps/site`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add apps/site/src/components/FeatureGrid.astro
git commit -m "feat(site): the six-card feature grid"
```

---

## Task 7: Assemble the landing page

**Files:**

- Modify: `apps/site/src/pages/index.astro` (replace Task 2's placeholder entirely)

**Interfaces:**

- Consumes: `SiteNav`, `Hero`, `QuickStart`, `ResolutionLayers`, `FeatureGrid` (Tasks 3–6).

- [ ] **Step 1: Replace the placeholder page with the real layout**

```astro
---
// apps/site/src/pages/index.astro
import '../styles/global.css'
import SiteNav from '../components/SiteNav.astro'
import Hero from '../components/Hero.astro'
import QuickStart from '../components/QuickStart.astro'
import ResolutionLayers from '../components/ResolutionLayers.astro'
import FeatureGrid from '../components/FeatureGrid.astro'
---
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <title>laqi — mock any API, flip any response, in one click</title>
    <meta
      name="description"
      content="laqi is a local mock server with a control panel. Point your app at it and put your API into any state — without touching a line of code."
    />
  </head>
  <body>
    <SiteNav />
    <Hero />
    <QuickStart />
    <ResolutionLayers />
    <FeatureGrid />
  </body>
</html>
```

- [ ] **Step 2: Build and verify the full page renders every section**

Run:

```
bun run build --filter=@laqi/site
grep -c "Mock any API" apps/site/dist/index.html
grep -c "Three steps, about a minute" apps/site/dist/index.html
grep -c "Four layers decide every response" apps/site/dist/index.html
grep -c "what if this fails" apps/site/dist/index.html
```

Expected: every `grep -c` prints `1` or more — each section is present in the built output.

- [ ] **Step 3: Commit**

```bash
git add apps/site/src/pages/index.astro
git commit -m "feat(site): assemble the landing page from all five sections"
```

---

## Task 8: Docs theming — mockup 5

**Files:**

- Modify: `apps/site/src/styles/global.css`

**Interfaces:**

- Consumes: the docs pages created in Task 2 (`docs/index.md`, `docs/installation.md`, `docs/concepts/resolution-layers.md`) as the pages this styling renders against.

- [ ] **Step 1: Add the active-sidebar-item marker and callout/table styling**

Mockup 5 shows three things beyond the base theme already applied in Task 2: a violet left-border marker on the current sidebar item, a violet-bordered inline "note" callout, and a table whose first column's cell colors match each layer's badge color from mockup 3. Append to `apps/site/src/styles/global.css`:

```css
/* Sidebar: the current page gets a violet left border, matching the
   panel's own "you are here" convention. */
starlight-nav-group [aria-current='page'],
.sidebar a[aria-current='page'] {
  border-left: 2px solid var(--vio);
  padding-left: 0.75rem;
  color: var(--fg);
}

/* Callouts (:::note in Starlight's markdown) */
.sl-markdown-content .starlight-aside--note {
  border-color: var(--vio);
  background: color-mix(in srgb, var(--vio) 8%, transparent);
}

/* Tables */
.sl-markdown-content table {
  border-collapse: collapse;
  width: 100%;
}
.sl-markdown-content th,
.sl-markdown-content td {
  border: 1px solid var(--line);
  padding: 0.6rem 1rem;
  text-align: left;
  font-family: var(--mono);
  font-size: 0.9rem;
}
.sl-markdown-content th {
  color: var(--dim);
  font-weight: 500;
  text-transform: uppercase;
  font-size: 0.75rem;
}

/* Code blocks: highlight response headers the same magenta the panel
   uses for a state-layer override, so an X-Laqi-Resolved example reads
   consistently between the docs and the product. */
.sl-markdown-content pre {
  background: var(--panel) !important;
  border: 1px solid var(--line);
}
```

- [ ] **Step 2: Use a `:::note` callout and the resolution-layers table together on the concepts page**

```md
<!-- apps/site/src/content/docs/docs/concepts/resolution-layers.md — replace the file from Task 2 with: -->
---
title: Resolution layers
description: The four layers that decide every response.
---

Every request laqi answers passes through four layers. The first one that
has an opinion wins, and the winner is reported back to you in three
places so the panel, the terminal, and your network tab can never
disagree.

:::note
A header override never changes panel state. It answers one request and
leaves no trace — which is what makes it safe to use inside an automated
test.
:::

## Order of precedence

| # | Layer | Set by | Persists |
| - | - | - | - |
| 1 | `header` | `X-Laqi-Response` on the request | no |
| 2 | `state` | a click in the control panel | yes |
| 3 | `scenario` | the active scenario, if it covers this route | yes |
| 4 | `default` | the `default` key in the mock file | — |

## Reading the winner

Every response carries a header naming the response and the layer that
chose it:

```

$ curl -i 127.0.0.1:8000/todos

HTTP/1.1 200 OK
content-type: application/json
x-laqi-resolved: error (state)

```

The same string appears in the terminal stream and in the panel's
request log. If you ever wonder why your app is seeing something odd,
that one line answers it.
```

- [ ] **Step 3: Build and verify the docs page renders the callout and table**

Run:

```
bun run build --filter=@laqi/site
grep -c "Order of precedence" apps/site/dist/docs/concepts/resolution-layers/index.html
grep -c "starlight-aside--note" apps/site/dist/docs/concepts/resolution-layers/index.html
```

Expected: both print `1` or more.

- [ ] **Step 4: Commit**

```bash
git add apps/site/src/styles/global.css apps/site/src/content/docs/docs/concepts/resolution-layers.md
git commit -m "feat(site): theme the docs section to match the product"
```

---

## Task 9: Content lint and link validator in CI

**Files:**

- Create: `scripts/site/content-lint.ts`
- Create: `scripts/site/content-lint.test.ts`
- Modify: `.github/workflows/validate.yml`

**Interfaces:**

- Produces: `bun scripts/site/content-lint.ts` — exits non-zero and prints every offending file:line if "Laqi" or "LAQI" appears outside a code span (inline `` `code` `` or a fenced code block) in any `.md`/`.astro` file under `apps/site/src`.

Note on sequencing: the spec's own rule is "add [the lint] with the first page, not the hundredth" — this task lands after Tasks 2 and 7 already wrote a handful of pages, not before any content existed. That's a small, acknowledged deviation (a few pages, not a hundred) made so this task's own tests could assert against real content instead of a synthetic fixture. Any future plan that adds a large volume of new site content should wire its lint in the _same_ task/commit as that content, not defer it to a later task like this one did.

- [ ] **Step 1: Write the failing test**

````ts
// scripts/site/content-lint.test.ts
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { findBrandCasingViolations } from './content-lint'

let dir: string

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
})

describe('findBrandCasingViolations', () => {
  it('flags "Laqi" in prose', () => {
    dir = mkdtempSync(join(tmpdir(), 'content-lint-'))
    writeFileSync(join(dir, 'page.md'), 'Laqi is a mock server.\n')
    const violations = findBrandCasingViolations(dir)
    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatchObject({ line: 1, match: 'Laqi' })
  })

  it('flags "LAQI" in prose', () => {
    dir = mkdtempSync(join(tmpdir(), 'content-lint-'))
    writeFileSync(join(dir, 'page.md'), 'Run LAQI to start.\n')
    const violations = findBrandCasingViolations(dir)
    expect(violations).toHaveLength(1)
  })

  it('does not flag "laqi" written correctly', () => {
    dir = mkdtempSync(join(tmpdir(), 'content-lint-'))
    writeFileSync(join(dir, 'page.md'), 'laqi is a mock server.\n')
    expect(findBrandCasingViolations(dir)).toHaveLength(0)
  })

  it('does not flag "Laqi" inside an inline code span', () => {
    dir = mkdtempSync(join(tmpdir(), 'content-lint-'))
    writeFileSync(join(dir, 'page.md'), 'The identifier is `Laqi.Client`.\n')
    expect(findBrandCasingViolations(dir)).toHaveLength(0)
  })

  it('does not flag "Laqi" inside a fenced code block', () => {
    dir = mkdtempSync(join(tmpdir(), 'content-lint-'))
    writeFileSync(join(dir, 'page.md'), '```\nconst Laqi = require("laqi")\n```\n')
    expect(findBrandCasingViolations(dir)).toHaveLength(0)
  })

  it('flags "Laqi" at the start of a sentence, the most common real mistake', () => {
    dir = mkdtempSync(join(tmpdir(), 'content-lint-'))
    writeFileSync(join(dir, 'page.md'), 'Setup\n\nLaqi runs on port 8000 by default.\n')
    const violations = findBrandCasingViolations(dir)
    expect(violations).toHaveLength(1)
    expect(violations[0]?.file).toMatch(/page\.md$/)
  })

  it('does not flag "Laqi" as a segment of a real hyphenated header name', () => {
    // X-Laqi-Response and X-Laqi-Resolved are real, already-shipped HTTP
    // headers (see packages/server/src/control-plane-app.ts) — this is
    // the correct capitalization for that identifier, not a casing
    // mistake. A plain \bLaqi\b regex would wrongly flag this: a hyphen
    // counts as a word boundary, so "X-Laqi-Response" reads as three
    // boundary-separated words to \b, the middle one matching "Laqi".
    dir = mkdtempSync(join(tmpdir(), 'content-lint-'))
    writeFileSync(
      join(dir, 'page.md'),
      'Every response carries an X-Laqi-Response header naming the winner, ' +
        'and laqi also sets X-Laqi-Resolved for the same purpose.\n',
    )
    expect(findBrandCasingViolations(dir)).toHaveLength(0)
  })
})
````

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run scripts/site/content-lint.test.ts`
Expected: FAIL — `./content-lint` has no exported member `findBrandCasingViolations`.

- [ ] **Step 3: Implement**

````ts
// scripts/site/content-lint.ts
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { extname, join } from 'node:path'

export type Violation = { file: string; line: number; match: string }

// A plain \b boundary treats a hyphen as a word edge, so \bLaqi\b would
// match the middle segment of X-Laqi-Response — a real, already-shipped
// HTTP header (packages/server/src/control-plane-app.ts), not a casing
// mistake. Requiring the character on either side to be neither a word
// character NOR a hyphen means "Laqi" only matches when it stands alone
// (space/punctuation/line-boundary on both sides), never as one segment
// of a hyphenated identifier.
const BRAND_MISCASING = /(?<![\w-])(Laqi|LAQI)(?![\w-])/g
const FENCE = /^```/

function stripInlineCode(line: string): string {
  // Inline code spans (`...`) are the one place brand casing can be a
  // real identifier (Laqi.Client, a class name) rather than a typo of
  // the product name in prose.
  return line.replace(/`[^`]*`/g, '')
}

function walk(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      files.push(...walk(full))
    } else if (['.md', '.mdx', '.astro'].includes(extname(full))) {
      files.push(full)
    }
  }
  return files
}

export function findBrandCasingViolations(rootDir: string): Violation[] {
  const violations: Violation[] = []
  for (const file of walk(rootDir)) {
    const lines = readFileSync(file, 'utf-8').split('\n')
    let inFence = false
    lines.forEach((rawLine, i) => {
      if (FENCE.test(rawLine)) {
        inFence = !inFence
        return
      }
      if (inFence) return
      const line = stripInlineCode(rawLine)
      const matches = line.match(BRAND_MISCASING)
      if (matches) {
        for (const match of matches) {
          violations.push({ file, line: i + 1, match })
        }
      }
    })
  }
  return violations
}

if (import.meta.main) {
  const target = process.argv[2] ?? 'apps/site/src'
  const violations = findBrandCasingViolations(target)
  if (violations.length > 0) {
    console.error(`Found ${violations.length} brand-casing violation(s):`)
    for (const v of violations) {
      console.error(`  ${v.file}:${v.line}  "${v.match}" — should be "laqi"`)
    }
    process.exit(1)
  }
  console.log('Content lint: clean.')
}
````

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run scripts/site/content-lint.test.ts`
Expected: PASS, all 6 cases.

- [ ] **Step 5: Run the lint against the real site content**

Run: `bun scripts/site/content-lint.ts apps/site/src`
Expected: `Content lint: clean.` — if it finds a real violation in content written by earlier tasks, fix that content file, not the lint.

- [ ] **Step 6: Add both checks to CI**

```yaml
# .github/workflows/validate.yml — add after the existing "Test" step
      - name: Build the site
        run: bun run build --filter=@laqi/site

      - name: Site content lint
        run: bun scripts/site/content-lint.ts apps/site/src

      - name: Site link check
        run: bunx --bun linkinator apps/site/dist --recurse --silent
```

Add `linkinator` as a root devDependency so `bunx` doesn't fetch it fresh on every CI run:

```json
// package.json — devDependencies
"linkinator": "^6.1.2",
```

- [ ] **Step 7: Verify locally**

Run:

```
bun add -D linkinator
bun run build --filter=@laqi/site
bunx linkinator apps/site/dist --recurse --silent
```

Expected: exits 0, no broken links reported (external links like the GitHub URL may be skipped/rate-limited in a sandboxed environment — if so, note it in the task report as a known CI-only check, not a local-verification gap).

- [ ] **Step 8: Commit**

```bash
git add scripts/site .github/workflows/validate.yml package.json bun.lock
git commit -m "test(site): content lint and link validator, wired into CI"
```

---

## Task 10: Deploy to Cloudflare Pages on merge to `main`

**Files:**

- Create: `.github/workflows/deploy-site.yml`
- Modify: `apps/documentation/src/content/docs/design/public-site.md` (record the Pages-vs-Workers deviation)

**Interfaces:**

- Consumes: `apps/site/dist` (Astro's static build output from every prior task).

- [ ] **Step 1: Record the Cloudflare Pages decision**

The original spec named Cloudflare Workers. This slice ships a fully static site with no server-side logic — the transport extraction and live demo island that would need a server runtime are explicitly deferred (Ruling 2, `public-site.md`). Cloudflare Pages is the standard, simpler deploy target for a static Astro build and needs no runtime bundle; revisit Workers only when a future slice adds server-side behavior. Append to `apps/documentation/src/content/docs/design/public-site.md`, right after the existing "Rulings (2026-08-29)" section:

```markdown
## Deploy target: Cloudflare Pages, not Workers

§14 named Cloudflare Workers. This first slice ships a fully static
build — no SSR, no edge functions, nothing the deferred transport
extraction or live demo island would need. Cloudflare Pages is the
standard target for a static Astro site: no runtime bundle, and its
GitHub Actions deploy step is simpler than Wrangler's Workers path.
Revisit Workers if a later slice adds a server-side requirement.
```

- [ ] **Step 2: Write the deploy workflow**

```yaml
# .github/workflows/deploy-site.yml
name: Deploy site

# Merge to main, not a tag: the site is content, and a typo fix must
# reach laqi.dev without cutting a version of the CLI. Path-filtered so
# an unrelated change elsewhere in the monorepo never triggers a deploy.
on:
  push:
    branches: [main]
    paths:
      - 'apps/site/**'
      - 'packages/tokens/**'
      - '.github/workflows/deploy-site.yml'

permissions:
  contents: read

concurrency:
  group: deploy-site
  cancel-in-progress: false

jobs:
  deploy:
    name: Build and deploy
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.3.4

      - run: bun install --frozen-lockfile

      - name: Build
        run: bun run build --filter=@laqi/site

      - name: Deploy to Cloudflare Pages
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: pages deploy apps/site/dist --project-name=laqi-dev
```

- [ ] **Step 3: Document the one-time setup this workflow needs**

Two repository secrets do not exist yet and must be created by hand before this workflow can succeed — same situation as `RELEASE_PLEASE_TOKEN` and `NPM_TOKEN` for the npm release pipeline. Add to `apps/site`'s own README (Step 4 below) rather than silently assuming they exist:

| Secret                  | What                                                          | Why                                                   |
| ----------------------- | ------------------------------------------------------------- | ----------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`  | Cloudflare API token with "Cloudflare Pages: Edit" permission | Lets the workflow deploy                              |
| `CLOUDFLARE_ACCOUNT_ID` | The Cloudflare account ID                                     | Identifies which account's Pages project to deploy to |

A Cloudflare Pages project named `laqi-dev` must also exist (created once, by hand, in the Cloudflare dashboard, connected to nothing — this workflow pushes to it directly via Wrangler rather than Cloudflare's own git integration, so the site deploys on the repo's own CI, not a second, redundant Cloudflare-side build).

- [ ] **Step 4: Write `apps/site/README.md`**

```md
# @laqi/site

laqi's public site — the landing page and user-facing docs at laqi.dev.
Built with [Astro](https://astro.build) + [Starlight](https://starlight.astro.build).

Separate from `apps/documentation`, which holds this repository's
internal ADRs, plans, and design docs and is never deployed.

## Structure

- `src/pages/index.astro` — the landing page, assembled from
  `src/components/*.astro`. Not part of Starlight's own routing.
- `src/content/docs/docs/**` — user docs, served at `/docs/*`.
- `src/content/docs/es/docs/**` — the Spanish docs locale, served at
  `/es/docs/*`.

## Commands

From the monorepo root:

| Command | Action |
| - | - |
| `bun run dev --filter=@laqi/site` | Local server at `localhost:4321` |
| `bun run build --filter=@laqi/site` | Production build to `./dist/` |
| `bun scripts/site/content-lint.ts apps/site/src` | Check for "Laqi"/"LAQI" outside code |

## Deploying

`.github/workflows/deploy-site.yml` deploys `apps/site/dist` to Cloudflare
Pages on every push to `main` that touches `apps/site/**` or
`packages/tokens/**`. Requires two repository secrets:
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` (Cloudflare Pages:
Edit permission), and a Cloudflare Pages project named `laqi-dev`
created once by hand.
```

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/deploy-site.yml apps/site/README.md apps/documentation/src/content/docs/design/public-site.md
git commit -m "ci(site): deploy to Cloudflare Pages on merge to main"
```

---

## Task 11: Final verification pass

**Files:** none — this task runs the full suite of checks across everything built in Tasks 1–10 and fixes anything that only shows up once every piece exists together.

- [ ] **Step 1: Full monorepo build**

Run: `bun install && bun run build`
Expected: every workspace package builds, including `@laqi/tokens`, `@laqi/site`, and the unmodified `@laqi/editor`/`apps/cli`.

- [ ] **Step 2: Full test suite**

Run: `bunx vitest run`
Expected: every test passes, including the new `packages/tokens/src/tokens.test.ts`, `apps/site/src/lib/version.test.ts`, and `scripts/site/content-lint.test.ts` — verify the total test-file count increased by exactly 3 over the pre-plan baseline.

- [ ] **Step 3: Lint and format**

Run: `bun run check:ci`
Expected: exit 0.

- [ ] **Step 4: Type-check**

Run: `bun run check-types`
Expected: reports one more successful project than before this plan (`@laqi/site`'s `astro check`); confirm the exact "N of N" count and that none regressed.

- [ ] **Step 5: Confirm `apps/documentation` is unreachable from the site**

Run: `grep -rn "apps/documentation\|documentacion" apps/site/src`
Expected: empty — nothing in the public site references the internal docs app.

- [ ] **Step 6: Confirm the content lint and link check both still pass against the final content**

Run:

```
bun run build --filter=@laqi/site
bun scripts/site/content-lint.ts apps/site/src
bunx linkinator apps/site/dist --recurse --silent
```

Expected: both clean.

- [ ] **Step 7: Confirm release-please still excludes the site**

Run: `grep -A3 '"exclude-paths"' release-please-config.json`
Expected: the array includes `"apps/site"` alongside `"apps/documentation"` and `"examples"`.

- [ ] **Step 8: Commit any fixes found in this pass**

```bash
git add -A
git commit -m "fix(site): address gaps found in final verification"
```

(Only if Steps 1–7 found something to fix — if everything was already clean, skip this commit.)
