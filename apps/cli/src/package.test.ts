import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(import.meta.dirname, '..', '..', '..')

function readJson(...parts: string[]): Record<string, unknown> {
  return JSON.parse(readFileSync(join(ROOT, ...parts), 'utf8')) as Record<string, unknown>
}

/** Every monorepo workspace, for the publishability test. */
const WORKSPACES: string[][] = [
  ['apps', 'cli', 'package.json'],
  ['apps', 'documentation', 'package.json'],
  ['packages', 'config', 'package.json'],
  ['packages', 'core', 'package.json'],
  ['packages', 'editor', 'package.json'],
  ['packages', 'generate', 'package.json'],
  ['packages', 'mcp', 'package.json'],
  ['packages', 'schema', 'package.json'],
  ['packages', 'server', 'package.json'],
  ['examples', 'todo-app', 'package.json'],
]

const cli = readJson('apps', 'cli', 'package.json')
const root = readJson('package.json')

const catalog = (root.workspaces as { catalog: Record<string, string> }).catalog
const dependencies = cli.dependencies as Record<string, string>
const devDependencies = cli.devDependencies as Record<string, string>

describe('the published package', () => {
  it('has no protocol npm cannot install', () => {
    // `catalog:` and `workspace:` are understood by bun and pnpm, not npm.
    // Publishing with one of those makes `npm install` fail with
    // EUNSUPPORTEDPROTOCOL on the installer's machine — and that isn't
    // visible until it's published.
    for (const [name, spec] of Object.entries(dependencies)) {
      expect(spec, `dependencies.${name}`).not.toMatch(/^(catalog|workspace|link|file):/)
    }
  })

  it('keeps its pinned versions in step with the root catalog', () => {
    // Pinned by hand because npm doesn't resolve `catalog:`. This test is
    // what stops a catalog bump from leaving the published package behind.
    for (const [name, spec] of Object.entries(catalog)) {
      const pinned = dependencies[name] ?? devDependencies[name]
      if (pinned === undefined) continue
      expect(pinned, `${name} must match the catalog`).toBe(spec)
    }
  })

  it('does not ship workspace packages as runtime dependencies', () => {
    // They're bundled by tsdown. Leaving them here would make npm look for
    // them in the registry, where they don't exist.
    for (const name of Object.keys(dependencies)) {
      expect(name.startsWith('@laqi/'), `${name} is bundled, not installed`).toBe(false)
    }
  })

  it('exposes the binary the README promises', () => {
    expect(cli.bin).toEqual({ laqi: './dist/index.mjs' })
  })

  it('ships only what the binary needs, plus the licence', () => {
    expect(cli.files).toEqual(['dist', 'LICENSE.md', 'README.md'])
  })

  it('declares the Node floor the build targets', () => {
    expect(cli.engines).toMatchObject({ node: '>=20' })
  })
})

describe('install weight', () => {
  it('does not drag the MCP SDK into every install', () => {
    // As an installed dependency it drags in express, jose, ajv and
    // friends: 91 packages and 24 MB on EVERY install, even if you never
    // run `laqi mcp`. It's bundled instead, and tree-shaking leaves out
    // the HTTP transport we don't use — measured: 97 installed packages
    // dropped to 6.
    expect(dependencies).not.toHaveProperty('@modelcontextprotocol/sdk')
    expect(devDependencies).toHaveProperty('@modelcontextprotocol/sdk')
  })

  it('keeps the runtime dependency list small on purpose', () => {
    expect(Object.keys(dependencies).sort()).toEqual([
      '@faker-js/faker',
      '@hono/node-server',
      'chokidar',
      'effect',
      'hono',
      'quicktype-core',
      'typescript',
      'zod',
    ])
  })
})

describe('lazy loading', () => {
  it('never imports the generation stack statically from the entry chunk', () => {
    // typescript is 23 MB and quicktype drags 25 packages; effect and
    // @faker-js/faker add more weight on top. They must load via dynamic
    // import() on first use, or every `laqi` startup pays for them. A
    // static `import ... from` in dist/index.mjs — the entry chunk that
    // always runs at startup — means someone broke it. tsdown code-splits
    // packages/generate into its own lazy chunk, which legitimately has a
    // static `from "effect"`: that chunk only loads on first generator
    // use, so it is out of scope for this guard.
    const entry = join(ROOT, 'apps', 'cli', 'dist', 'index.mjs')
    if (!existsSync(entry)) {
      console.warn(
        'skipping: apps/cli/dist/index.mjs not built — run `bun run build --filter=laqi`',
      )
      return
    }
    const source = readFileSync(entry, 'utf8')
    for (const dependency of ['typescript', 'quicktype-core', '@faker-js/faker', 'effect']) {
      expect(source, `dist/index.mjs imports ${dependency} statically`).not.toMatch(
        new RegExp(`from\\s*["']${dependency}["']`),
      )
    }
  })
})

describe('what gets published', () => {
  it('publishes as "laqi" — the package that already exists on npm', () => {
    // laqi 1.2.1 is already on npm and owned by the same account. This is
    // its 2.0.0, not a new package: that's why `npx laqi` works and why
    // `laqi migrate` exists to convert v1 projects.
    expect(cli.name).toBe('laqi')
    expect(cli.bin).toEqual({ laqi: './dist/index.mjs' })
  })

  it('keeps every internal package unpublishable', () => {
    // They're bundled inside the binary. Without `private`, an `npm
    // publish` from their folder would try to create the @laqi scope,
    // which doesn't exist.
    for (const workspace of ['core', 'mcp', 'schema', 'server', 'editor', 'config', 'generate']) {
      const pkg = readJson('packages', workspace, 'package.json')
      expect(pkg.private, `packages/${workspace} must be private`).toBe(true)
    }
  })

  it('is the only workspace that is publishable', () => {
    const publishable = WORKSPACES.filter((path) => readJson(...path).private !== true)
    expect(publishable).toEqual([['apps', 'cli', 'package.json']])
  })
})

describe('the licence', () => {
  const licence = readFileSync(join(ROOT, 'LICENSE.md'), 'utf8')

  it('agrees with what package.json declares', () => {
    // They used to diverge: LICENSE.md said ISC and package.json said MIT,
    // so the package published metadata that contradicted its own file.
    expect(cli.license).toBe('MIT')
    expect(licence).toContain('MIT License')
  })

  it('is a real MIT text, not just a title', () => {
    // The two clauses that make MIT what it is: the broad permission and
    // the condition to keep the notice.
    expect(licence).toContain('Permission is hereby granted, free of charge')
    expect(licence).toContain(
      'The above copyright notice and this permission notice shall be included in all copies',
    )
    expect(licence).toContain('WITHOUT WARRANTY OF ANY KIND')
  })

  it('keeps the copyright holder', () => {
    expect(licence).toMatch(/Copyright \(c\) \d{4} Cristian Sotomayor/)
  })

  it('ships inside the published package', () => {
    // MIT requires the notice to be in every copy. Without this the
    // tarball carried no licence at all, and the package asked for credit
    // without saying whose.
    expect(cli.files).toContain('LICENSE.md')
  })
})
