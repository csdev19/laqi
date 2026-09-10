import { describe, expect, it } from 'vitest'
import { importSchema } from './import-schema'
import { examplePointer, extractResponseSchema, responsePointer } from './openapi-extract'

const SPEC = {
  openapi: '3.0.3',
  paths: {
    '/invoices/{id}': {
      get: {
        responses: {
          '200': {
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Invoice' },
                example: { id: 'inv_1', total: 42, note: null },
              },
            },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      Invoice: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          total: { type: 'number' },
          lines: { type: 'array', items: { $ref: '#/components/schemas/Line' } },
          note: { type: 'string', nullable: true },
        },
        required: ['id', 'total'],
      },
      Line: {
        type: 'object',
        properties: { label: { type: 'string' } },
        required: ['label'],
      },
    },
  },
}

const POINTER = responsePointer('/invoices/{id}', 'get', '200')

describe('pointing at a response', () => {
  it('escapes the path, so a slash in it is not a pointer segment', () => {
    expect(POINTER).toBe(
      '/paths/~1invoices~1{id}/get/responses/200/content/application~1json/schema',
    )
  })

  it('points at the media type for an example, one level above the schema', () => {
    expect(examplePointer('/invoices/{id}', 'get', '200')).toBe(
      '/paths/~1invoices~1{id}/get/responses/200/content/application~1json',
    )
  })
})

describe('lifting a response schema out of its document', () => {
  it('carries the components it refers to, repointed at $defs', () => {
    const extracted = extractResponseSchema(SPEC, POINTER)

    expect(extracted).toMatchObject({ ok: true })
    if (!extracted.ok) return
    expect(extracted.document['$ref']).toBe('#/$defs/Invoice')
    const defs = extracted.document['$defs'] as Record<string, Record<string, unknown>>
    expect(Object.keys(defs).sort()).toEqual(['Invoice', 'Line'])
    // Nested references are repointed too, not only the top one.
    const invoice = defs['Invoice'] as Record<string, unknown>
    const lines = (invoice['properties'] as Record<string, unknown>)['lines'] as Record<
      string,
      unknown
    >
    expect(lines['items']).toEqual({ $ref: '#/$defs/Line' })
  })

  // Extraction hands back an OpenAPI-shaped document. Declaring the stored
  // dialect here would tell the normalizer there was nothing to rewrite.
  it('declares no dialect, leaving that to normalization', () => {
    const extracted = extractResponseSchema(SPEC, POINTER)

    expect(extracted.ok && extracted.document).not.toHaveProperty('$schema')
  })

  it('says what is missing when the pointer leads nowhere', () => {
    const extracted = extractResponseSchema(SPEC, '/paths/~1nope/get')

    expect(extracted).toMatchObject({ ok: false })
    if (extracted.ok) return
    expect(extracted.diagnostics[0]?.message).toContain('/paths/~1nope/get')
  })

  // A schema describing JSON that itself contains a "$ref" key is data, and
  // rewriting it would corrupt the thing being described.
  it('leaves a $ref that is not a reference alone', () => {
    const spec = {
      paths: {
        '/x': {
          get: {
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: { $ref: { type: 'string' } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    }

    const extracted = extractResponseSchema(spec, responsePointer('/x', 'get', '200'))

    expect(extracted).toMatchObject({ ok: true })
    if (!extracted.ok) return
    const properties = extracted.document['properties'] as Record<string, unknown>
    expect(properties['$ref']).toEqual({ type: 'string' })
  })
})

describe('importing an OpenAPI response', () => {
  it('normalizes 3.0 spellings and records where it came from', async () => {
    const { snapshot } = await importSchema({
      kind: 'openapi',
      document: SPEC,
      pointer: POINTER,
      name: 'Invoice',
    })

    expect(snapshot.name).toBe('Invoice')
    expect(snapshot.source).toEqual({ kind: 'openapi', pointer: POINTER })
    expect(snapshot.document['$schema']).toBe('https://json-schema.org/draft/2020-12/schema')
    // `nullable: true` in 3.0 is a type union in 2020-12.
    const defs = snapshot.document['$defs'] as Record<string, Record<string, unknown>>
    const invoice = defs['Invoice'] as Record<string, unknown>
    const note = (invoice['properties'] as Record<string, unknown>)['note']
    expect(note).toMatchObject({ type: ['string', 'null'] })
    expect(snapshot.diagnostics.some((item) => item.code === 'dialect.normalized')).toBe(true)
  }, 30_000)

  it('generates a body the extracted document actually describes', async () => {
    const { snapshot } = await importSchema({
      kind: 'openapi',
      document: SPEC,
      pointer: POINTER,
      name: 'Invoice',
    })
    const { previewBody } = await import('./import-schema')
    const preview = await previewBody(snapshot, { seed: 5 })

    const body = preview.body as Record<string, unknown>
    expect(typeof body['id']).toBe('string')
    expect(typeof body['total']).toBe('number')
  }, 30_000)

  it('refuses a pointer that leads nowhere, with the pointer in the message', async () => {
    await expect(
      importSchema({ kind: 'openapi', document: SPEC, pointer: '/paths/~1ghost/get' }),
    ).rejects.toThrow(/ghost/)
  }, 30_000)
})
