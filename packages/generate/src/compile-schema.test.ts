import { describe, expect, it } from 'vitest'
import { EXAMPLE_CASES, goldenPath, SHAPE_CASES } from './characterization.catalog'
import { compileSchema } from './compile-schema'
import { generateFromPlan, liftShape } from './plan'
import { shapeToJsonSchema } from './json-schema'
import { primitive, type Shape } from './shape'
import { DIALECT_2020_12 } from '@laqi/schema'
import { readFileSync } from 'node:fs'

const asDocument = (shape: Shape) => ({ $schema: DIALECT_2020_12, ...shapeToJsonSchema(shape) })

const compiled = (document: unknown) => {
  const result = compileSchema(document)
  if (!result.ok) throw new Error(`expected a plan, got ${JSON.stringify(result.diagnostics)}`)
  return result
}

describe('the emitter invariant', () => {
  it('compiles what shapeToJsonSchema emits back into the plan the Shape lifts to', () => {
    for (const testCase of SHAPE_CASES) {
      expect(compiled(asDocument(testCase.shape)).plan, testCase.id).toEqual(
        liftShape(testCase.shape),
      )
    }
  })

  it('reports nothing for a document laqi emitted itself', () => {
    for (const testCase of SHAPE_CASES) {
      expect(compiled(asDocument(testCase.shape)).diagnostics, testCase.id).toEqual([])
    }
  })

  it('generates the phase-1 goldens from the compiled plan, value for value', async () => {
    for (const testCase of SHAPE_CASES) {
      const golden: unknown = JSON.parse(readFileSync(goldenPath(testCase.id), 'utf8'))
      const plan = compiled(asDocument(testCase.shape)).plan
      expect(await generateFromPlan(plan, testCase.options), testCase.id).toEqual(golden)
    }
  })

  it('holds for the four example models, which are the realistic shapes', async () => {
    for (const testCase of EXAMPLE_CASES) {
      const shape: Shape = JSON.parse(
        readFileSync(goldenPath(`example-${testCase.id}.shape`), 'utf8'),
      )
      const body: unknown = JSON.parse(
        readFileSync(goldenPath(`example-${testCase.id}.body`), 'utf8'),
      )
      const plan = compiled(asDocument(shape)).plan
      expect(plan, testCase.id).toEqual(liftShape(shape))
      expect(await generateFromPlan(plan, testCase.options), testCase.id).toEqual(body)
    }
  })
})

describe('the minimum vocabulary', () => {
  it('reads each primitive type', () => {
    expect(compiled({ type: 'string' }).plan).toEqual({ kind: 'primitive', type: 'string' })
    expect(compiled({ type: 'number' }).plan).toEqual({ kind: 'primitive', type: 'number' })
    expect(compiled({ type: 'integer' }).plan).toEqual({ kind: 'primitive', type: 'integer' })
    expect(compiled({ type: 'boolean' }).plan).toEqual({ kind: 'primitive', type: 'boolean' })
    expect(compiled({ type: 'null' }).plan).toEqual({ kind: 'primitive', type: 'null' })
  })

  it('reads a date-time string as a date, which is what makes it generate one', () => {
    expect(compiled({ type: 'string', format: 'date-time' }).plan).toEqual({
      kind: 'primitive',
      type: 'date',
    })
  })

  it('reads an empty schema as unconstrained', () => {
    expect(compiled({}).plan).toEqual({ kind: 'unknown' })
    expect(compiled({ $schema: DIALECT_2020_12 }).plan).toEqual({ kind: 'unknown' })
  })

  it('reads true as unconstrained and refuses false, which nothing satisfies', () => {
    expect(compiled(true).plan).toEqual({ kind: 'unknown' })
    const refused = compileSchema(false)
    expect(refused.ok).toBe(false)
    expect(refused.diagnostics[0]?.code).toBe('unsatisfiable')
  })

  it('reads an enum as a literal choice, and refuses an empty one', () => {
    expect(compiled({ enum: ['a', 1, true, null] }).plan).toEqual({
      kind: 'literals',
      values: ['a', 1, true, null],
    })
    expect(compileSchema({ enum: [] }).diagnostics[0]?.code).toBe('unsatisfiable')
  })

  it('reads an object, taking optionality from required', () => {
    expect(
      compiled({
        type: 'object',
        properties: { a: { type: 'string' }, b: { type: 'integer' } },
        required: ['a'],
        additionalProperties: false,
      }).plan,
    ).toEqual({
      kind: 'object',
      fields: [
        { name: 'a', plan: { kind: 'primitive', type: 'string' }, optional: false },
        { name: 'b', plan: { kind: 'primitive', type: 'integer' }, optional: true },
      ],
    })
  })

  it('reads an open object with no properties as a record of its value schema', () => {
    expect(compiled({ type: 'object', additionalProperties: { type: 'string' } }).plan).toEqual({
      kind: 'record',
      values: { kind: 'primitive', type: 'string' },
    })
  })

  it('reads an object that constrains nothing as an empty object', () => {
    expect(compiled({ type: 'object' }).plan).toEqual({ kind: 'object', fields: [] })
  })

  it('reads an array and a tuple apart', () => {
    expect(compiled({ type: 'array', items: { type: 'integer' } }).plan).toEqual({
      kind: 'array',
      items: { kind: 'primitive', type: 'integer' },
    })
    expect(
      compiled({
        type: 'array',
        prefixItems: [{ type: 'integer' }, { type: 'string' }],
        items: false,
        minItems: 2,
        maxItems: 2,
      }).plan,
    ).toEqual({
      kind: 'tuple',
      items: [
        { kind: 'primitive', type: 'integer' },
        { kind: 'primitive', type: 'string' },
      ],
    })
  })

  it('ignores annotations, which never change what is generated', () => {
    expect(
      compiled({
        $schema: DIALECT_2020_12,
        $id: 'https://example.test/invoice',
        title: 'Invoice',
        description: 'a bill',
        examples: [{ a: 1 }],
        default: null,
        deprecated: true,
        $comment: 'note',
        type: 'string',
      }).plan,
    ).toEqual({ kind: 'primitive', type: 'string' })
  })
})

describe('what the compiler refuses', () => {
  it('names the keyword it does not understand', () => {
    const result = compileSchema({ type: 'string', pattern: '^a' })
    expect(result.ok).toBe(false)
    expect(result.diagnostics[0]?.code).toBe('unsupported.keyword')
    expect(result.diagnostics[0]?.message).toContain('pattern')
  })

  it('points at where the trouble is, so a large document can be searched', () => {
    const result = compileSchema({
      type: 'object',
      properties: { a: { type: 'array', items: { type: 'string', pattern: '^a' } } },
      required: ['a'],
      additionalProperties: false,
    })
    expect(result.diagnostics[0]?.pointer).toBe('/properties/a/items')
  })

  it('refuses something that is not a schema at all', () => {
    for (const input of [null, 'a string', 42, ['an', 'array']]) {
      const result = compileSchema(input)
      expect(result.ok, JSON.stringify(input)).toBe(false)
      expect(result.diagnostics[0]?.code).toBe('invalid.document')
    }
  })

  it('refuses a type it has no generator for', () => {
    expect(compileSchema({ type: 'bigint' }).diagnostics[0]?.code).toBe('unsupported.keyword')
  })
})
