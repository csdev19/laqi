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

  // OpenAPI writes the storage width on nearly every number. Refusing it
  // meant a real spec imported with most of its bodies missing.
  it('accepts the OpenAPI numeric formats, which only say how wide the value is', () => {
    expect(compiled({ type: 'integer', format: 'int64' }).plan).toEqual({
      kind: 'primitive',
      type: 'integer',
    })
    expect(compiled({ type: 'integer', format: 'int32' }).plan).toEqual({
      kind: 'primitive',
      type: 'integer',
    })
    expect(compiled({ type: 'number', format: 'double' }).plan).toEqual({
      kind: 'primitive',
      type: 'number',
    })
    expect(compiled({ type: 'number', format: 'float' }).plan).toEqual({
      kind: 'primitive',
      type: 'number',
    })
  })

  it('reads an integer format on a number as a promise that the number is whole', () => {
    expect(compiled({ type: 'number', format: 'int64' }).plan).toEqual({
      kind: 'primitive',
      type: 'integer',
    })
  })

  it('keeps int32 bounds inside the range an int32 can hold', () => {
    expect(
      compiled({ type: 'integer', format: 'int32', minimum: -1e12, maximum: 1e12 }).plan,
    ).toEqual({
      kind: 'primitive',
      type: 'integer',
      number: { minimum: -2147483648, maximum: 2147483647 },
    })
  })

  // A JSON number past 2^53 reaches every JavaScript client as a different
  // number. OpenAPI specs routinely write int64's own limits as the bounds.
  it('keeps int64 bounds inside the safe-integer range', () => {
    expect(
      compiled({
        type: 'integer',
        format: 'int64',
        minimum: -(2 ** 63), // what JSON.parse makes of int64's -9223372036854775808
        maximum: 2 ** 63, // what JSON.parse makes of int64's 9223372036854775807
      }).plan,
    ).toEqual({
      kind: 'primitive',
      type: 'integer',
      number: { minimum: Number.MIN_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER },
    })
  })

  it('refuses a bound that lies wholly outside the format, instead of generating past it', () => {
    const tooLow = refused({ type: 'integer', format: 'int32', minimum: 2 ** 40 })
    expect(tooLow.code).toBe('unsatisfiable')
    expect(tooLow.message).toContain('"int32"')
    expect(tooLow.message).toContain(String(2 ** 40))

    expect(refused({ type: 'integer', format: 'int32', maximum: -(2 ** 40) }).code).toBe(
      'unsatisfiable',
    )
    expect(refused({ type: 'integer', format: 'int32', exclusiveMinimum: 2147483647 }).code).toBe(
      'unsatisfiable',
    )
    expect(refused({ type: 'integer', format: 'int64', minimum: 2 ** 60 }).code).toBe(
      'unsatisfiable',
    )
  })

  it('keeps a lone minimum near the top of a format from drawing past it', () => {
    expect(compiled({ type: 'integer', format: 'int32', minimum: 2147483000 }).plan).toEqual({
      kind: 'primitive',
      type: 'integer',
      number: { minimum: 2147483000, maximum: 2147483647 },
    })
    // Far from the edge nothing is added: the generator's own window decides.
    expect(compiled({ type: 'integer', format: 'int32', minimum: 0 }).plan).toEqual({
      kind: 'primitive',
      type: 'integer',
      number: { minimum: 0 },
    })
  })

  it('refuses a numeric format it does not know, by name', () => {
    const diagnostic = refused({ type: 'integer', format: 'uint128' })
    expect(diagnostic.code).toBe('unsupported.keyword')
    expect(diagnostic.message).toContain('"uint128"')
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
    // Each conditional keyword on its own, built from names rather than as
    // a literal: an object with a `then` key is a thenable, and lint refuses
    // to see one written down for good reasons of its own.
    for (const keyword of ['if', 'then', 'else']) {
      const conditional = Object.fromEntries([[keyword, { type: 'string' }]])
      expect(refused(conditional).code, keyword).toBe('unsupported.keyword')
    }
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
