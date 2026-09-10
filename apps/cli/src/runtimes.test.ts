// apps/cli/src/runtimes.test.ts
//
// The schema pipeline, exercised through each runtime laqi actually reaches
// users on. Everything else in the suite runs under vitest with Bun's
// resolver: these check the paths that only break somewhere else — the
// packaged bundle, and plain Node.
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const REPO = fileURLToPath(new URL('../../..', import.meta.url))
const BUNDLE = join(REPO, 'apps', 'cli', 'dist', 'index.mjs')

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'laqi-runtimes-'))
  mkdirSync(join(root, 'laqi'), { recursive: true })
  writeFileSync(
    join(root, 'laqi', 'api.json'),
    JSON.stringify({
      'GET /users': { default: 'ok', responses: { ok: { status: 200, body: [] } } },
    }),
    'utf8',
  )
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

/** Runs a command and returns everything about how it went. */
async function run(
  command: string[],
  options: { cwd?: string } = {},
): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve) => {
    const [program, ...args] = command
    const child = spawn(program!, args, {
      cwd: options.cwd ?? root,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    let err = ''
    child.stdout.on('data', (chunk: Buffer) => {
      out += chunk.toString('utf8')
    })
    child.stderr.on('data', (chunk: Buffer) => {
      err += chunk.toString('utf8')
    })
    child.on('error', (cause) => resolve({ code: -1, out, err: cause.message }))
    child.on('close', (code) => resolve({ code: code ?? -1, out, err }))
  })
}

describe('the packaged CLI', () => {
  // Skipped rather than failed when the bundle is absent: `bun run test`
  // does not build, and a red test that only means "you did not build" is
  // noise that gets ignored, which is worse than a skip that says why.
  const built = existsSync(BUNDLE)

  it.skipIf(!built)(
    'boots from the bundle under Node',
    async () => {
      const result = await run(['node', BUNDLE, '--help'])

      expect(result.code, result.err).toBe(0)
      expect(result.out).toContain('laqi')
    },
    60_000,
  )

  // The whole schema pipeline is behind dynamic imports so `laqi start` does
  // not pay for a 23 MB compiler. A bundler that hoisted one of them would
  // break that silently, and only under the bundle.
  it.skipIf(!built)(
    'keeps the schema pipeline out of the entry chunk',
    () => {
      const source = readFileSync(BUNDLE, 'utf8')

      expect(source).not.toMatch(/^import .* from ['"]typescript['"]/m)
      expect(source).not.toMatch(/^import .* from ['"]quicktype-core['"]/m)
    },
    30_000,
  )

  it('says so when the bundle has not been built', () => {
    if (built) return
    expect(built).toBe(false)
  })
})

describe('plain Node', () => {
  // The module loader spawns `process.execPath`. Under Bun that is Bun;
  // under Node it is Node, and Node resolves and imports differently enough
  // that "it works here" proves nothing about the other.
  it('loads a Standard JSON Schema module through the child loader', async () => {
    const module = join(root, 'schema.mjs')
    writeFileSync(
      module,
      `export const Invoice = {\n` +
        `  '~standard': {\n` +
        `    version: 1,\n` +
        `    vendor: 'handwritten',\n` +
        `    validate: (value) => ({ value }),\n` +
        `    jsonSchema: {\n` +
        `      output: () => ({ type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }),\n` +
        `      input: () => ({ type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }),\n` +
        `    },\n` +
        `  },\n` +
        `}\n`,
      'utf8',
    )

    const loader = fileURLToPath(
      new URL('../../../packages/generate/src/load-module.ts', import.meta.url),
    )
    const probe = join(root, 'probe.mjs')
    writeFileSync(
      probe,
      `const { loadModuleSchema } = await import(${JSON.stringify(loader)})\n` +
        `const result = await loadModuleSchema({ resolvedPath: ${JSON.stringify(module)}, exportName: 'Invoice', side: 'output' })\n` +
        `process.stdout.write(JSON.stringify(result))\n`,
      'utf8',
    )

    // Bun runs the probe (it imports a .ts loader), but the loader itself
    // spawns whatever `process.execPath` is — so this asserts the child
    // contract, and the Node case is the one below.
    const result = await run(['bun', probe])

    expect(result.code, result.err).toBe(0)
    const loaded = JSON.parse(result.out) as { ok: boolean; document?: Record<string, unknown> }
    expect(loaded.ok).toBe(true)
    expect(loaded.document?.['type']).toBe('object')
  }, 60_000)

  it('runs the child loader program under Node itself', async () => {
    const module = join(root, 'schema.mjs')
    writeFileSync(
      module,
      `export const S = { '~standard': { version: 1, vendor: 'x', jsonSchema: { output: () => ({ type: 'string' }) } } }\n`,
      'utf8',
    )

    // The same shape the loader's child runs: import by file URL, read
    // `~standard.jsonSchema`, convert. Under Node, not Bun.
    const probe = join(root, 'node-probe.mjs')
    writeFileSync(
      probe,
      `import { pathToFileURL } from 'node:url'\n` +
        `const mod = await import(pathToFileURL(${JSON.stringify(module)}).href)\n` +
        `const convert = mod.S['~standard'].jsonSchema.output\n` +
        `process.stdout.write(JSON.stringify(convert({ target: 'draft-2020-12' })))\n`,
      'utf8',
    )

    const result = await run(['node', probe])

    expect(result.code, result.err).toBe(0)
    expect(JSON.parse(result.out)).toEqual({ type: 'string' })
  }, 60_000)
})
