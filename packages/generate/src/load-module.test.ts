import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { loadModuleSchema } from './load-module'

const VENDORS = fileURLToPath(new URL('../fixtures/vendors.ts', import.meta.url))
const scratch = mkdtempSync(join(tmpdir(), 'laqi-modules-'))

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true })
})

/** Writes a module into scratch space and returns its path. */
function moduleWith(name: string, source: string): string {
  const path = join(scratch, name)
  writeFileSync(path, source, 'utf8')
  return path
}

const load = (exportName: string, side: 'input' | 'output' = 'output') =>
  loadModuleSchema({ resolvedPath: VENDORS, exportName, side })

describe('reading a schema out of a real library', () => {
  it('converts a Zod object, keeping the closure Zod itself emits', async () => {
    const result = await load('ZodInvoice')

    expect(result).toMatchObject({ ok: true })
    if (!result.ok) return
    expect(result.document['type']).toBe('object')
    expect(result.document['$schema']).toBe('https://json-schema.org/draft/2020-12/schema')
    expect(result.document['required']).toEqual(['id', 'total', 'status'])
    // Zod says the object is closed. laqi stores that, and does not add it
    // to a library that says nothing.
    expect(result.document['additionalProperties']).toBe(false)
  }, 30_000)

  it('converts an ArkType object, and does not close what ArkType left open', async () => {
    const result = await load('ArkInvoice')

    expect(result).toMatchObject({ ok: true })
    if (!result.ok) return
    expect(result.document['required']).toEqual(['id', 'total'])
    expect(result.document).not.toHaveProperty('additionalProperties')
  }, 30_000)

  it('asks for the side it was told to, not whichever one exists', async () => {
    const output = await load('ZodInvoice', 'output')
    const input = await load('ZodInvoice', 'input')

    expect(output).toMatchObject({ ok: true })
    expect(input).toMatchObject({ ok: true })
  }, 30_000)
})

describe('refusing what it cannot read', () => {
  // Valibot 1.5 implements Standard Schema validation but not the JSON
  // Schema extension. This is the real shape of the capability failure.
  it('names the export when a library offers no JSON Schema conversion', async () => {
    const result = await load('ValibotInvoice')

    expect(result).toMatchObject({ ok: false, code: 'capability' })
    if (result.ok) return
    expect(result.error).toContain('ValibotInvoice')
    expect(result.error).toContain('valibot')
  }, 30_000)

  it('refuses a plain object that is no schema at all', async () => {
    const result = await load('notASchema')

    expect(result).toMatchObject({ ok: false, code: 'capability' })
  }, 30_000)

  it("reports the vendor's own message when a converter throws", async () => {
    const result = await load('ThrowsOnConvert')

    expect(result).toMatchObject({ ok: false, code: 'conversion' })
    if (result.ok) return
    expect(result.error).toBe('cannot convert a transform to JSON Schema')
  }, 30_000)

  it('lists what the module does export when the name is wrong', async () => {
    const result = await load('Nope')

    expect(result).toMatchObject({ ok: false, code: 'not-found' })
    if (result.ok) return
    expect(result.error).toContain('ZodInvoice')
  }, 30_000)
})

describe('surviving the module', () => {
  it('reports a module that throws on import, instead of dying with it', async () => {
    const path = moduleWith('throws.mjs', `throw new Error('boom on import')\n`)

    const result = await loadModuleSchema({
      resolvedPath: path,
      exportName: 'Anything',
      side: 'output',
    })

    expect(result).toMatchObject({ ok: false, code: 'crashed' })
    if (result.ok) return
    expect(result.error).toContain('boom on import')
  }, 30_000)

  it('kills a module that never finishes importing', async () => {
    // A timer, not a bare never-settling promise: a runtime detects the
    // latter and exits, which would test the wrong thing.
    const path = moduleWith(
      'hangs.mjs',
      `await new Promise((resolve) => setTimeout(resolve, 60000))\n`,
    )

    const started = Date.now()
    const result = await loadModuleSchema({
      resolvedPath: path,
      exportName: 'Anything',
      side: 'output',
    })

    expect(result).toMatchObject({ ok: false, code: 'timeout' })
    // The budget is 10s; anything much beyond it means nothing was killed.
    expect(Date.now() - started).toBeLessThan(20_000)
  }, 40_000)

  it('reads the verdict even when the module printed on its way in', async () => {
    const path = moduleWith(
      'chatty.mjs',
      `console.log('loading the schema…')\nexport const S = { '~standard': { version: 1, vendor: 'x', jsonSchema: { output: () => ({ type: 'string' }) } } }\n`,
    )

    const result = await loadModuleSchema({
      resolvedPath: path,
      exportName: 'S',
      side: 'output',
    })

    expect(result).toMatchObject({ ok: true })
    if (!result.ok) return
    expect(result.document['type']).toBe('string')
  }, 30_000)
})
