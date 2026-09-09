import { describe, expect, it } from 'vitest'
import { ResponseSchema } from './response'

describe('ResponseSchema', () => {
  it('accepts a minimal response', () => {
    const parsed = ResponseSchema.parse({ status: 200, body: { message: 'OK' } })
    expect(parsed.status).toBe(200)
  })

  it('accepts a response with no body (204)', () => {
    expect(ResponseSchema.parse({ status: 204 }).status).toBe(204)
  })

  it('accepts delay and headers', () => {
    const parsed = ResponseSchema.parse({
      status: 200,
      body: [],
      delay: 3000,
      headers: { 'x-custom': 'yes' },
    })
    expect(parsed.delay).toBe(3000)
    expect(parsed.headers).toEqual({ 'x-custom': 'yes' })
  })

  it('rejects a status outside 100-599', () => {
    expect(ResponseSchema.safeParse({ status: 99 }).success).toBe(false)
    expect(ResponseSchema.safeParse({ status: 600 }).success).toBe(false)
  })

  it('rejects a status given as a string (v1 defect I)', () => {
    expect(ResponseSchema.safeParse({ status: '200' }).success).toBe(false)
  })

  it('rejects a negative delay', () => {
    expect(ResponseSchema.safeParse({ status: 200, delay: -1 }).success).toBe(false)
  })
})

/**
 * A response is associated with a schema, and separately records whether laqi
 * generated the body it currently holds. The two are independent: an OpenAPI
 * example has a schema and no generation, a hand-written response has neither.
 */
describe('schema', () => {
  const document = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    properties: { id: { type: 'number' } },
    required: ['id'],
  }
  const schema = {
    name: 'Todo',
    document,
    source: { kind: 'typescript-paste' },
    diagnostics: [],
  }

  it('accepts a response carrying the schema it is associated with', () => {
    const result = ResponseSchema.safeParse({ status: 200, body: { id: 1 }, schema })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.schema?.name).toBe('Todo')
  })

  it('is optional, because a hand-written response has none', () => {
    expect(ResponseSchema.safeParse({ status: 200, body: {} }).success).toBe(true)
  })

  it('refuses a schema whose document does not declare draft 2020-12', () => {
    const stale = { ...schema, document: { type: 'object' } }
    expect(ResponseSchema.safeParse({ status: 200, schema: stale }).success).toBe(false)
  })
})

describe('generation', () => {
  const generation = { seed: 7, options: { arrayLength: 3 }, bodyHash: 'a'.repeat(64) }

  it('accepts the evidence for a body laqi generated', () => {
    const result = ResponseSchema.safeParse({ status: 200, body: { id: 1 }, generation })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.generation?.seed).toBe(7)
  })

  it('refuses evidence with no seed, which could not reproduce anything', () => {
    expect(
      ResponseSchema.safeParse({
        status: 200,
        generation: { options: { arrayLength: 3 }, bodyHash: 'a'.repeat(64) },
      }).success,
    ).toBe(false)
  })
})

/**
 * The two experiments this replaces. Both stored generation metadata beside
 * the body: one the pasted TypeScript, the other a packed Shape. Neither gets
 * a compatibility branch, because quietly dropping the field would leave a
 * mock that regenerates from nothing with no explanation.
 */
describe('the generatedFrom field this replaces', () => {
  it('is refused by name rather than quietly dropped', () => {
    for (const generatedFrom of [
      { typeName: 'Todo', model: 'export interface Todo { id: number }' },
      { typeName: 'Todo', recipe: ['o', [['id', 0, 'n']]] },
    ]) {
      const result = ResponseSchema.safeParse({ status: 200, body: {}, generatedFrom })
      expect(result.success).toBe(false)
      const message = JSON.stringify(result.error?.issues)
      expect(message).toContain('generatedFrom')
      expect(message).toContain('schema')
    }
  })

  it('says nothing about a response that never had one', () => {
    expect(ResponseSchema.safeParse({ status: 200, body: {} }).success).toBe(true)
  })
})
