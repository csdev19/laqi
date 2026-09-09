import { DIALECT_2020_12 } from '@laqi/schema'
import Ajv2020 from 'ajv/dist/2020'
import addFormats from 'ajv-formats'
import { describe, expect, it } from 'vitest'
import { EXAMPLE_CASES, goldenPath, SHAPE_CASES } from './characterization.catalog'
import { compileSchema } from './compile-schema'
import { shapeToJsonSchema } from './json-schema'
import { generateFromPlan } from './plan'
import type { Shape } from './shape'
import { readFileSync } from 'node:fs'

/**
 * laqi's own agreement between compiler and generator proves only that the
 * two agree. This checks the thing that actually matters: that a body laqi
 * generated satisfies the document it was generated from, according to a
 * validator that shares no code with laqi.
 *
 * A dev dependency. laqi never validates a served or saved body at run time.
 */
// `strictRequired` is off because it polices document style, not validity:
// naming a required property with no schema beside it is legal 2020-12, and
// is a form laqi accepts with a warning. Every other strictness stays on.
const ajv = addFormats(new Ajv2020({ strict: true, strictRequired: false, allErrors: true }))

function expectValid(document: Record<string, unknown>, body: unknown, label: string) {
  const validate = ajv.compile(document)
  const valid = validate(body)
  expect(
    valid,
    `${label}: ${ajv.errorsText(validate.errors)}\n${JSON.stringify(body).slice(0, 400)}`,
  ).toBe(true)
}

describe('every generated body satisfies its own document', () => {
  it('for every characterised Shape', async () => {
    for (const testCase of SHAPE_CASES) {
      const document = { $schema: DIALECT_2020_12, ...shapeToJsonSchema(testCase.shape) }
      const compiled = compileSchema(document)
      if (!compiled.ok) throw new Error(`${testCase.id} did not compile`)
      expectValid(document, await generateFromPlan(compiled.plan, testCase.options), testCase.id)
    }
  })

  it('for the four example models', async () => {
    for (const testCase of EXAMPLE_CASES) {
      const shape: Shape = JSON.parse(
        readFileSync(goldenPath(`example-${testCase.id}.shape`), 'utf8'),
      )
      const document = { $schema: DIALECT_2020_12, ...shapeToJsonSchema(shape) }
      const compiled = compileSchema(document)
      if (!compiled.ok) throw new Error(`${testCase.id} did not compile`)
      expectValid(document, await generateFromPlan(compiled.plan, testCase.options), testCase.id)
    }
  })
})

describe('every additive keyword laqi claims to honour', () => {
  const fixtures: Record<string, Record<string, unknown>> = {
    const: { const: 'issued' },
    'type union': { type: ['string', 'null'] },
    'enum with null': { enum: ['a', 2, null] },
    'number bounds': { type: 'number', minimum: 1.5, maximum: 9.5 },
    'exclusive bounds': { type: 'integer', exclusiveMinimum: 0, exclusiveMaximum: 10 },
    multipleOf: { type: 'integer', minimum: 0, maximum: 100, multipleOf: 25 },
    'string length': { type: 'string', minLength: 3, maxLength: 7 },
    'format date': { type: 'string', format: 'date' },
    'format email': { type: 'string', format: 'email' },
    'format uri': { type: 'string', format: 'uri' },
    'format uuid': { type: 'string', format: 'uuid' },
    'format date-time': { type: 'string', format: 'date-time' },
    'array length': { type: 'array', items: { type: 'integer' }, minItems: 2, maxItems: 4 },
    'unique items': {
      type: 'array',
      items: { type: 'integer' },
      minItems: 4,
      maxItems: 4,
      uniqueItems: true,
    },
    tuple: {
      type: 'array',
      prefixItems: [{ type: 'integer' }, { type: 'string' }],
      items: false,
      minItems: 2,
      maxItems: 2,
    },
    record: { type: 'object', additionalProperties: { type: 'string' } },
    anyOf: { anyOf: [{ type: 'string' }, { type: 'integer' }] },
    oneOf: { oneOf: [{ const: 'a' }, { const: 'b' }] },
    allOf: {
      allOf: [
        { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
        { type: 'object', properties: { b: { type: 'integer' } }, required: ['b'] },
      ],
    },
    'required without a schema': {
      type: 'object',
      properties: { a: { type: 'string' } },
      required: ['a', 'b'],
    },
    'a reference': {
      $defs: { Money: { type: 'number', minimum: 0 } },
      type: 'object',
      properties: { total: { $ref: '#/$defs/Money' } },
      required: ['total'],
    },
  }

  for (const [label, fixture] of Object.entries(fixtures)) {
    it(`generates a body that satisfies ${label}`, async () => {
      const document = { $schema: DIALECT_2020_12, ...fixture }
      const compiled = compileSchema(document)
      if (!compiled.ok) {
        throw new Error(`${label} did not compile: ${JSON.stringify(compiled.diagnostics)}`)
      }
      // Several seeds: one lucky value would not prove a range is honoured.
      for (let seed = 0; seed < 12; seed++) {
        expectValid(document, await generateFromPlan(compiled.plan, { seed }), `${label} @ ${seed}`)
      }
    })
  }
})
