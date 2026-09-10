import { DIALECT_2020_12, type SchemaSnapshot } from '@laqi/schema'
import { describe, expect, it } from 'vitest'
import { exportTypes } from './export-types'
import { importSchema } from './import-schema'
import { printDocumentTypeScript } from './print-document'

const keysOf = (code: string, name: string): string[] => {
  const block = code.split(`export interface ${name} {`)[1]?.split('}')[0] ?? ''
  return [...block.matchAll(/^\s+"?([\w$]+)"?\??:/gm)].map((match) => match[1]!)
}

/** An OpenAPI-shaped document: a shared component, referenced twice. */
const INVOICE = {
  $schema: DIALECT_2020_12,
  type: 'object',
  properties: {
    id: { type: 'string' },
    status: { enum: ['draft', 'issued', 'paid'] },
    issuedAt: { type: 'string', format: 'date-time' },
    billing: { $ref: '#/$defs/Address' },
    shipping: { $ref: '#/$defs/Address' },
    note: { type: ['string', 'null'] },
    point: { type: 'array', prefixItems: [{ type: 'number' }, { type: 'number' }], items: false },
    tags: { type: 'array', items: { type: 'string' } },
    extra: { type: 'object', additionalProperties: { type: 'number' } },
  },
  required: ['id', 'status', 'issuedAt', 'billing', 'point'],
  $defs: {
    Address: {
      type: 'object',
      properties: { street: { type: 'string' }, city: { type: 'string' } },
      required: ['street', 'city'],
    },
  },
}

describe('printing a document as TypeScript', () => {
  const code = printDocumentTypeScript(INVOICE, 'Invoice')

  it('keeps the keys where the document has them', () => {
    expect(keysOf(code, 'Invoice')).toEqual([
      'id',
      'status',
      'issuedAt',
      'billing',
      'shipping',
      'note',
      'point',
      'tags',
      'extra',
    ])
  })

  it('keeps a shared $defs component as one interface under its own name', () => {
    expect(code).toContain('billing: Address;')
    expect(code).toContain('shipping?: Address;')
    expect(code.match(/export interface Address \{/g)).toHaveLength(1)
    expect(keysOf(code, 'Address')).toEqual(['street', 'city'])
  })

  it('prints every kind the compiler accepts', () => {
    expect(code).toContain('status: "draft" | "issued" | "paid";')
    expect(code).toContain('issuedAt: Date;')
    expect(code).toContain('note?: string | null;')
    expect(code).toContain('point: [number, number];')
    expect(code).toContain('tags?: string[];')
    expect(code).toContain('extra?: Record<string, number>;')
  })

  it('prints unions and intersections with their parentheses where they matter', () => {
    const printed = printDocumentTypeScript(
      {
        type: 'object',
        properties: {
          either: { anyOf: [{ type: 'string' }, { type: 'number' }] },
          list: { type: 'array', items: { anyOf: [{ type: 'string' }, { type: 'null' }] } },
          both: {
            allOf: [
              { type: 'object', properties: { a: { type: 'string' } } },
              { type: 'object', properties: { b: { type: 'string' } } },
            ],
          },
        },
      },
      'Mixed',
    )

    expect(printed).toContain('either?: string | number;')
    expect(printed).toContain('list?: (string | null)[];')
    expect(printed).toContain('both?: Both & Both2;')
  })

  it('names a root that is not an object', () => {
    const printed = printDocumentTypeScript(
      { type: 'array', items: { type: 'object', properties: { id: { type: 'string' } } } },
      'Users',
    )

    expect(printed).toContain('export type Users = User[];')
    expect(printed).toContain('export interface User {')
  })
})

describe('exporting TypeScript from a stored schema', () => {
  const snapshotOf = (document: Record<string, unknown>): SchemaSnapshot => ({
    name: 'Invoice',
    document: { $schema: DIALECT_2020_12, ...document },
    source: { kind: 'typescript-paste' },
    diagnostics: [],
  })

  // The whole point: what a person pasted comes back in the order they
  // wrote it, not alphabetised by a translator.
  it('gives back a pasted model in the order it was written', async () => {
    const { snapshot } = await importSchema({
      kind: 'typescript-paste',
      source: 'export interface T { zebra: string; apple: number; mango?: boolean }',
    })

    const exported = await exportTypes(snapshot, 'typescript')

    expect(keysOf(exported.code, 'T')).toEqual(['zebra', 'apple', 'mango'])
    expect(exported.language).toBe('typescript')
  }, 30_000)

  it('is the default target', async () => {
    const exported = await exportTypes(snapshotOf(INVOICE))
    expect(exported.language).toBe('typescript')
    expect(keysOf(exported.code, 'Invoice')[0]).toBe('id')
  }, 30_000)

  it('still reports what TypeScript cannot hold, which for a tuple is nothing', async () => {
    // TypeScript has real tuples, and laqi prints them: the approximation
    // quicktype makes does not apply to this target any more.
    const exported = await exportTypes(snapshotOf(INVOICE), 'typescript')
    expect(exported.code).toContain('point: [number, number];')
    expect(exported.diagnostics).toEqual([])
  }, 30_000)

  it('leaves every other language to quicktype', async () => {
    const exported = await exportTypes(snapshotOf(INVOICE), 'python')
    expect(exported.language).toBe('python')
    expect(exported.code.toLowerCase()).toContain('invoice')
    expect(exported.diagnostics.map((item) => item.code)).toEqual(['export.tuple-approximated'])
  }, 30_000)
})
