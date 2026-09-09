import { describe, expect, it } from 'vitest'
import { compileSchema } from './compile-schema'

const compiled = (document: unknown) => {
  const result = compileSchema(document)
  if (!result.ok) throw new Error(`refused: ${JSON.stringify(result.diagnostics)}`)
  return result
}

const refused = (document: unknown) => {
  const result = compileSchema(document)
  expect(result.ok, `expected ${JSON.stringify(document)} to be refused`).toBe(false)
  return result.diagnostics[0]!
}

describe('scalars', () => {
  it('reads const as the one value it permits', () => {
    expect(compiled({ const: 'issued' }).plan).toEqual({ kind: 'literals', values: ['issued'] })
    expect(compiled({ const: null }).plan).toEqual({ kind: 'literals', values: [null] })
  })

  it('refuses a const laqi cannot pick, rather than picking something else', () => {
    expect(refused({ const: { a: 1 } }).code).toBe('unsupported.keyword')
  })

  it('reads a list of types as a choice between them', () => {
    expect(compiled({ type: ['string', 'null'] }).plan).toEqual({
      kind: 'choice',
      options: [
        { kind: 'primitive', type: 'string' },
        { kind: 'primitive', type: 'null' },
      ],
    })
  })

  it('refuses a list holding a type that needs more than a name', () => {
    expect(refused({ type: ['string', 'object'] }).code).toBe('unsupported.keyword')
  })
})

describe('numbers', () => {
  it('carries the bounds into the plan', () => {
    expect(compiled({ type: 'integer', minimum: 1, maximum: 9, multipleOf: 3 }).plan).toEqual({
      kind: 'primitive',
      type: 'integer',
      number: { minimum: 1, maximum: 9, multipleOf: 3 },
    })
  })

  it('turns exclusive bounds into inclusive ones the generator can use', () => {
    expect(compiled({ type: 'integer', exclusiveMinimum: 0, exclusiveMaximum: 10 }).plan).toEqual({
      kind: 'primitive',
      type: 'integer',
      number: { minimum: 1, maximum: 9 },
    })
  })

  it('adds no rule when the document states no bounds, so a plain type stays plain', () => {
    expect(compiled({ type: 'number' }).plan).toEqual({ kind: 'primitive', type: 'number' })
  })

  it('refuses bounds that cross, which nothing satisfies', () => {
    expect(refused({ type: 'integer', minimum: 10, maximum: 1 }).code).toBe('unsatisfiable')
    expect(refused({ type: 'integer', exclusiveMinimum: 5, exclusiveMaximum: 6 }).code).toBe(
      'unsatisfiable',
    )
  })
})

describe('strings', () => {
  it('carries lengths and the formats it can generate', () => {
    expect(compiled({ type: 'string', minLength: 2, maxLength: 8, format: 'uuid' }).plan).toEqual({
      kind: 'primitive',
      type: 'string',
      text: { minLength: 2, maxLength: 8, format: 'uuid' },
    })
  })

  it('keeps date-time as the date primitive rather than a string format', () => {
    expect(compiled({ type: 'string', format: 'date-time' }).plan).toEqual({
      kind: 'primitive',
      type: 'date',
    })
  })

  it('refuses a format it cannot generate, and refuses pattern outright', () => {
    expect(refused({ type: 'string', format: 'hostname' }).code).toBe('unsupported.keyword')
    expect(refused({ type: 'string', pattern: '^a' }).code).toBe('unsupported.keyword')
  })

  it('refuses lengths that cross', () => {
    expect(refused({ type: 'string', minLength: 9, maxLength: 2 }).code).toBe('unsatisfiable')
  })
})

describe('arrays', () => {
  it('carries a length rule', () => {
    expect(
      compiled({ type: 'array', items: { type: 'integer' }, minItems: 2, maxItems: 5 }).plan,
    ).toEqual({
      kind: 'array',
      items: { kind: 'primitive', type: 'integer' },
      length: { min: 2, max: 5 },
    })
  })

  it('carries uniqueItems only when it is true', () => {
    expect(
      compiled({ type: 'array', items: { type: 'integer' }, uniqueItems: true }).plan,
    ).toMatchObject({ length: { unique: true } })
    expect(
      compiled({ type: 'array', items: { type: 'integer' }, uniqueItems: false }).plan,
    ).toEqual({ kind: 'array', items: { kind: 'primitive', type: 'integer' } })
  })

  it('refuses lengths that cross', () => {
    expect(
      refused({ type: 'array', items: { type: 'integer' }, minItems: 5, maxItems: 2 }).code,
    ).toBe('unsatisfiable')
  })

  it('refuses the array keywords it does not honour', () => {
    expect(
      refused({ type: 'array', items: { type: 'integer' }, contains: { const: 1 } }).code,
    ).toBe('unsupported.keyword')
  })
})

describe('combinations', () => {
  it('reads anyOf of scalars as a choice', () => {
    expect(compiled({ anyOf: [{ type: 'string' }, { type: 'integer' }] }).plan).toEqual({
      kind: 'choice',
      options: [
        { kind: 'primitive', type: 'string' },
        { kind: 'primitive', type: 'integer' },
      ],
    })
  })

  it('reads oneOf of enums as a choice too', () => {
    expect(compiled({ oneOf: [{ enum: ['a'] }, { const: 2 }] }).plan).toEqual({
      kind: 'choice',
      options: [
        { kind: 'literals', values: ['a'] },
        { kind: 'literals', values: [2] },
      ],
    })
  })

  it('refuses a choice between objects, which laqi will not pick for the caller', () => {
    expect(
      refused({
        oneOf: [
          { type: 'object', properties: { a: { type: 'string' } } },
          { type: 'object', properties: { b: { type: 'string' } } },
        ],
      }).code,
    ).toBe('unsupported.combination')
  })

  it('merges allOf of objects whose properties do not overlap', () => {
    expect(
      compiled({
        allOf: [
          { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
          { type: 'object', properties: { b: { type: 'integer' } } },
        ],
      }).plan,
    ).toEqual({
      kind: 'object',
      fields: [
        { name: 'a', plan: { kind: 'primitive', type: 'string' }, optional: false },
        { name: 'b', plan: { kind: 'primitive', type: 'integer' }, optional: true },
      ],
    })
  })

  it('refuses an allOf whose members claim the same property', () => {
    const refusal = refused({
      allOf: [
        { type: 'object', properties: { a: { type: 'string' } } },
        { type: 'object', properties: { a: { type: 'integer' } } },
      ],
    })
    expect(refusal.code).toBe('unsupported.combination')
    expect(refusal.message).toContain('a')
  })

  it('refuses the combinations it has no rule for', () => {
    expect(refused({ not: { type: 'string' } }).code).toBe('unsupported.keyword')
    expect(refused({ if: { type: 'string' }, then: { const: 'a' } }).code).toBe(
      'unsupported.keyword',
    )
  })
})

describe('objects laqi will not generate', () => {
  it('refuses the object keywords outside the supported set', () => {
    for (const keyword of [
      'patternProperties',
      'propertyNames',
      'dependentRequired',
      'unevaluatedProperties',
    ]) {
      expect(refused({ type: 'object', properties: {}, [keyword]: {} }).code).toBe(
        'unsupported.keyword',
      )
    }
  })
})
