import { DIALECT_2020_12 } from '@laqi/schema'
import { describe, expect, it } from 'vitest'
import { normalizeDialect } from './normalize-dialect'

const normalized = (document: unknown, options?: { assume?: 'openapi-3.0' }) => {
  const result = normalizeDialect(document, options)
  if (!result.ok) throw new Error(`refused: ${JSON.stringify(result.diagnostics)}`)
  return result
}

describe('draft 2020-12', () => {
  it('passes a document that already speaks it through untouched, and says nothing', () => {
    const document = { $schema: DIALECT_2020_12, type: 'string' }
    const result = normalized(document)
    expect(result.document).toEqual(document)
    expect(result.diagnostics).toEqual([])
  })
})

describe('an absent $schema', () => {
  it('is assumed to be 2020-12, and says so rather than deciding silently', () => {
    const result = normalized({ type: 'string' })
    expect(result.document).toEqual({ $schema: DIALECT_2020_12, type: 'string' })
    expect(result.diagnostics).toHaveLength(1)
    expect(result.diagnostics[0]?.code).toBe('dialect.normalized')
    expect(result.diagnostics[0]?.kind).toBe('information')
    expect(result.diagnostics[0]?.message).toContain('2020-12')
  })
})

describe('draft-07', () => {
  const draft07 = (rest: Record<string, unknown>) => ({
    $schema: 'http://json-schema.org/draft-07/schema#',
    ...rest,
  })

  it('rewrites definitions to $defs', () => {
    const result = normalized(
      draft07({ definitions: { Money: { type: 'number' } }, $ref: '#/definitions/Money' }),
    )
    expect(result.document.$defs).toEqual({ Money: { type: 'number' } })
    expect(result.document.definitions).toBeUndefined()
  })

  it('rewrites a pointer into definitions so it still resolves', () => {
    const result = normalized(draft07({ $ref: '#/definitions/Money' }))
    expect(result.document.$ref).toBe('#/$defs/Money')
  })

  it('rewrites the array form of items into prefixItems, and additionalItems into items', () => {
    const result = normalized(
      draft07({
        type: 'array',
        items: [{ type: 'integer' }, { type: 'string' }],
        additionalItems: false,
      }),
    )
    expect(result.document).toMatchObject({
      type: 'array',
      prefixItems: [{ type: 'integer' }, { type: 'string' }],
      items: false,
    })
    expect(result.document.additionalItems).toBeUndefined()
  })

  it('leaves the single-schema form of items alone', () => {
    const result = normalized(draft07({ type: 'array', items: { type: 'integer' } }))
    expect(result.document.items).toEqual({ type: 'integer' })
  })

  it('rewrites at every depth, not only at the root', () => {
    const result = normalized(
      draft07({
        type: 'object',
        properties: { a: { type: 'array', items: [{ type: 'integer' }] } },
      }),
    )
    expect((result.document.properties as Record<string, Record<string, unknown>>).a).toMatchObject(
      {
        prefixItems: [{ type: 'integer' }],
      },
    )
  })

  it('stamps the stored document with 2020-12 and reports the rewrite once', () => {
    const result = normalized(draft07({ type: 'string' }))
    expect(result.document.$schema).toBe(DIALECT_2020_12)
    expect(result.diagnostics.map((d) => d.code)).toEqual(['dialect.normalized'])
  })
})

describe('OpenAPI 3.0', () => {
  it('is only assumed when the importer says so, never guessed from the document', () => {
    const document = { type: 'string', nullable: true }
    expect(normalized(document).document.nullable).toBe(true)
    expect(normalized(document, { assume: 'openapi-3.0' }).document.nullable).toBeUndefined()
  })

  it('turns nullable into a type union with null', () => {
    const result = normalized({ type: 'string', nullable: true }, { assume: 'openapi-3.0' })
    expect(result.document).toMatchObject({ type: ['string', 'null'] })
  })

  it('drops nullable: false without widening the type', () => {
    const result = normalized({ type: 'string', nullable: false }, { assume: 'openapi-3.0' })
    expect(result.document).toMatchObject({ type: 'string' })
    expect(result.document.nullable).toBeUndefined()
  })

  it('turns a single example into the 2020-12 examples array', () => {
    const result = normalized({ type: 'string', example: 'inv_1' }, { assume: 'openapi-3.0' })
    expect(result.document).toMatchObject({ examples: ['inv_1'] })
    expect(result.document.example).toBeUndefined()
  })

  it('reports the rewrite', () => {
    const result = normalized({ type: 'string', nullable: true }, { assume: 'openapi-3.0' })
    expect(result.diagnostics.map((d) => d.code)).toEqual(['dialect.normalized'])
  })
})

describe('a dialect laqi does not normalize', () => {
  it('fails, naming what it was given', () => {
    const result = normalizeDialect({ $schema: 'http://json-schema.org/draft-04/schema#' })
    expect(result.ok).toBe(false)
    expect(result.diagnostics[0]?.code).toBe('dialect.unknown')
    expect(result.diagnostics[0]?.message).toContain('draft-04')
  })

  it('fails on a $schema that is not a string', () => {
    expect(normalizeDialect({ $schema: 7 }).ok).toBe(false)
  })
})

describe('what normalization refuses to touch', () => {
  it('refuses a document that is not a schema', () => {
    const result = normalizeDialect(['not', 'a', 'schema'])
    expect(result.ok).toBe(false)
    expect(result.diagnostics[0]?.code).toBe('invalid.document')
  })

  it('leaves the input untouched, returning a new document', () => {
    const document = { type: 'array', items: [{ type: 'integer' }] }
    normalized({ $schema: 'http://json-schema.org/draft-07/schema#', ...document })
    expect(document.items).toEqual([{ type: 'integer' }])
  })
})
