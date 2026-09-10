import { DIALECT_2020_12, type SchemaSnapshot } from '@laqi/schema'
import { describe, expect, it } from 'vitest'
import { capabilities, exportTypes } from './export-types'

function snapshotOf(document: Record<string, unknown>, name = 'Invoice'): SchemaSnapshot {
  return {
    name,
    document: { $schema: DIALECT_2020_12, ...document },
    source: { kind: 'typescript-paste' },
    diagnostics: [],
  }
}

const OBJECT = snapshotOf({
  type: 'object',
  properties: { id: { type: 'string' }, total: { type: 'number' } },
  required: ['id', 'total'],
})

const TUPLE = snapshotOf({
  type: 'object',
  properties: {
    point: {
      type: 'array',
      prefixItems: [{ type: 'number' }, { type: 'number' }],
      items: false,
      minItems: 2,
      maxItems: 2,
    },
  },
  required: ['point'],
})

describe('exporting a stored schema', () => {
  it('prints the document, not a shape derived from it', async () => {
    const exported = await exportTypes(OBJECT)

    expect(exported.language).toBe('typescript')
    expect(exported.code).toContain('Invoice')
    expect(exported.code).toContain('id')
    expect(exported.diagnostics).toEqual([])
  }, 30_000)

  it('prints into another target when asked', async () => {
    const exported = await exportTypes(OBJECT, 'python')

    expect(exported.language).toBe('python')
    expect(exported.code.toLowerCase()).toContain('invoice')
  }, 30_000)

  it('says which language it does not know, rather than printing the wrong one', async () => {
    await expect(exportTypes(OBJECT, 'cobol')).rejects.toThrow(/unknown language/)
  }, 30_000)
})

describe('what the exporter cannot express', () => {
  // The exported type accepts three numbers; the schema does not, and
  // generation does not. Anyone copying the types has to be told.
  it('reports a tuple as approximated, pointing at where it is', async () => {
    const exported = await exportTypes(TUPLE, 'python')

    expect(exported.diagnostics.map((item) => item.code)).toEqual(['export.tuple-approximated'])
    expect(exported.diagnostics[0]?.pointer).toBe('/properties/point/prefixItems')
  }, 30_000)

  it('reports it on every quicktype target, because none of them renders one', async () => {
    for (const target of ['python', 'go', 'rust']) {
      const exported = await exportTypes(TUPLE, target)
      expect(exported.diagnostics.map((item) => item.code)).toEqual(['export.tuple-approximated'])
    }
  }, 60_000)

  // TypeScript is printed by laqi, with real tuples: nothing was lost.
  it('has nothing to report for TypeScript, which laqi prints itself', async () => {
    const exported = await exportTypes(TUPLE, 'typescript')
    expect(exported.code).toContain('point: [number, number];')
    expect(exported.diagnostics).toEqual([])
  }, 30_000)

  // The snapshot describes the import. A re-export must not rewrite it.
  it('returns the export diagnostics without touching the snapshot', async () => {
    const before = JSON.stringify(TUPLE)
    await exportTypes(TUPLE)

    expect(JSON.stringify(TUPLE)).toBe(before)
    expect(TUPLE.diagnostics).toEqual([])
  }, 30_000)
})

describe('what this build can do', () => {
  it('lists the source kinds the importer actually serves', async () => {
    const listed = await capabilities()

    expect(listed.inputs).toEqual(['typescript-paste', 'json-schema', 'openapi', 'project-module'])
  }, 30_000)

  // A hand-kept list goes stale, and the failure the user sees is a target
  // that errors when picked. Every advertised target has to print.
  it('advertises only targets that print', async () => {
    const listed = await capabilities()
    expect(listed.exports.targets.length).toBeGreaterThan(5)

    const failures: string[] = []
    for (const target of listed.exports.targets) {
      try {
        await exportTypes(OBJECT, target)
      } catch (cause) {
        failures.push(`${target}: ${cause instanceof Error ? cause.message : String(cause)}`)
      }
    }

    expect(failures).toEqual([])
  }, 120_000)
})
