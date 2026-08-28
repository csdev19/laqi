import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(import.meta.dirname, '..', '..', '..')

function readJson(...parts: string[]): Record<string, unknown> {
  return JSON.parse(readFileSync(join(ROOT, ...parts), 'utf8')) as Record<string, unknown>
}

/** Todo workspace del monorepo, para el test de publicabilidad. */
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
    // `catalog:` y `workspace:` los entienden bun y pnpm, no npm. Publicar
    // con uno de esos hace que `npm install` falle con EUNSUPPORTEDPROTOCOL
    // en la máquina de quien lo instale — y eso no se ve hasta publicar.
    for (const [name, spec] of Object.entries(dependencies)) {
      expect(spec, `dependencies.${name}`).not.toMatch(/^(catalog|workspace|link|file):/)
    }
  })

  it('keeps its pinned versions in step with the root catalog', () => {
    // Se fijan a mano porque npm no resuelve `catalog:`. Este test es lo que
    // evita que un bump del catálogo deje el paquete publicado atrás.
    for (const [name, spec] of Object.entries(catalog)) {
      const pinned = dependencies[name] ?? devDependencies[name]
      if (pinned === undefined) continue
      expect(pinned, `${name} must match the catalog`).toBe(spec)
    }
  })

  it('does not ship workspace packages as runtime dependencies', () => {
    // Se bundlean con tsdown. Dejarlos acá haría que npm los busque en el
    // registro, donde no existen.
    for (const name of Object.keys(dependencies)) {
      expect(name.startsWith('@laqi/'), `${name} is bundled, not installed`).toBe(false)
    }
  })

  it('exposes the binary the README promises', () => {
    expect(cli.bin).toEqual({ laqi: './dist/index.mjs' })
  })

  it('ships only what the binary needs, plus the licence', () => {
    expect(cli.files).toEqual(['dist', 'README.md', 'LICENSE.md'])
  })

  it('declares the Node floor the build targets', () => {
    expect(cli.engines).toMatchObject({ node: '>=20' })
  })
})

describe('install weight', () => {
  it('does not drag the MCP SDK into every install', () => {
    // Como dependencia instalada arrastra express, jose, ajv y compañía:
    // 91 paquetes y 24 MB en TODA instalación, aunque nunca corras
    // `laqi mcp`. Va bundleada, y el tree-shaking deja fuera el transport
    // HTTP que no usamos — medido: 97 paquetes instalados pasaron a 6.
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
      console.warn('skipping: apps/cli/dist/index.mjs not built — run `bun run build --filter=laqi`')
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
    // laqi 1.2.1 ya está en npm y es del mismo dueño. Esto es su 2.0.0, no
    // un paquete nuevo: por eso `npx laqi` funciona y por eso existe
    // `laqi migrate` para convertir los proyectos de v1.
    expect(cli.name).toBe('laqi')
    expect(cli.bin).toEqual({ laqi: './dist/index.mjs' })
  })

  it('keeps every internal package unpublishable', () => {
    // Van bundleados dentro del binario. Sin `private`, un `npm publish`
    // desde su carpeta intentaría crear el scope @laqi, que no existe.
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
    // Antes divergían: LICENSE.md decía ISC y package.json MIT, así que el
    // paquete publicaba metadata que contradecía su propio archivo.
    expect(cli.license).toBe('MIT')
    expect(licence).toContain('MIT License')
  })

  it('is a real MIT text, not just a title', () => {
    // Las dos cláusulas que hacen a MIT lo que es: el permiso amplio y la
    // condición de conservar el aviso.
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
    // MIT exige que el aviso esté en toda copia. Sin esto el tarball no
    // llevaba ninguna licencia, y el paquete pedía crédito sin decir de quién.
    expect(cli.files).toContain('LICENSE.md')
  })
})
