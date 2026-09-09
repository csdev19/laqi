import type { ExampleModelId } from './examples'
import { primitive, type Shape } from './shape'

/**
 * The shared contract fixtures phase 1 exists to produce.
 *
 * Every case here is generated once, and its output is committed under
 * `goldens/`. Two things depend on that:
 *
 * 1. `characterization.test.ts` fails when today's `generate()` changes.
 * 2. The JSON Schema compiler must reproduce these bytes from
 *    `shapeToJsonSchema(shape)` at the same seed and options. That is the
 *    phase-2 non-regression invariant, and these files are its oracle.
 *
 * So a golden is never updated to make a test pass. It is updated when a
 * deliberate behaviour change is being recorded, in the same commit as the
 * change, with the diff read.
 */
export type GenerateOptions = { seed: number; arrayLength?: number }

export type ShapeCase = {
  /** Also the golden's file name. */
  id: string
  /** What this case pins, in one line. Read alongside the golden diff. */
  pins: string
  shape: Shape
  options: GenerateOptions
}

/**
 * Field names here are deliberately neutral (`plain`, `value`) except where a
 * case exists to pin a heuristic. `generate.test.ts` owns the rule tables;
 * these goldens own structure.
 */
export const SHAPE_CASES: readonly ShapeCase[] = [
  {
    id: 'primitive-string',
    pins: 'a bare string shape, with no field name to match a rule against',
    shape: primitive('string'),
    options: { seed: 1 },
  },
  {
    id: 'primitive-number',
    pins: 'a bare number: float, not integer',
    shape: primitive('number'),
    options: { seed: 1 },
  },
  {
    id: 'primitive-integer',
    pins: 'a bare integer',
    shape: primitive('integer'),
    options: { seed: 1 },
  },
  {
    id: 'primitive-boolean',
    pins: 'a bare boolean',
    shape: primitive('boolean'),
    options: { seed: 1 },
  },
  {
    id: 'primitive-null',
    pins: 'null is the value, not an absence',
    shape: primitive('null'),
    options: { seed: 1 },
  },
  {
    id: 'primitive-date',
    pins: 'a date is an ISO 8601 string, relative to the fixed reference date',
    shape: primitive('date'),
    options: { seed: 1 },
  },
  {
    id: 'unknown',
    pins: 'unknown generates null',
    shape: { kind: 'unknown' },
    options: { seed: 1 },
  },
  {
    id: 'literals-strings',
    pins: 'one member of the union is chosen, and which one is seed-stable',
    shape: { kind: 'literals', values: ['draft', 'issued', 'paid', 'void'] },
    options: { seed: 1 },
  },
  {
    id: 'literals-mixed',
    pins: 'a union may mix string, number and boolean members',
    shape: { kind: 'literals', values: ['a', 2, true] },
    options: { seed: 1 },
  },
  {
    id: 'object-required-and-optional',
    pins: 'THE optional-presence fact: an optional field is always present',
    shape: {
      kind: 'object',
      fields: [
        { name: 'required', shape: primitive('string'), optional: false },
        { name: 'optional', shape: primitive('string'), optional: true },
        { name: 'optionalObject', shape: { kind: 'object', fields: [] }, optional: true },
      ],
    },
    options: { seed: 1 },
  },
  {
    id: 'object-empty',
    pins: 'an object with no fields is an empty object, not null',
    shape: { kind: 'object', fields: [] },
    options: { seed: 1 },
  },
  {
    id: 'object-property-order',
    pins: 'properties are emitted in declaration order',
    shape: {
      kind: 'object',
      fields: [
        { name: 'zeta', shape: primitive('integer'), optional: false },
        { name: 'alpha', shape: primitive('integer'), optional: false },
        { name: 'mid', shape: primitive('integer'), optional: false },
      ],
    },
    options: { seed: 1 },
  },
  {
    id: 'array-default-length',
    pins: 'an array with no arrayLength option uses the default length',
    shape: { kind: 'array', items: primitive('integer') },
    options: { seed: 1 },
  },
  {
    id: 'array-explicit-length',
    pins: 'arrayLength sets the length of every array in the call',
    shape: { kind: 'array', items: primitive('integer') },
    options: { seed: 1, arrayLength: 5 },
  },
  {
    id: 'array-of-objects',
    pins: 'a sequential id field keeps counting across an array',
    shape: {
      kind: 'array',
      items: {
        kind: 'object',
        fields: [
          { name: 'id', shape: primitive('integer'), optional: false },
          { name: 'label', shape: primitive('string'), optional: false },
        ],
      },
    },
    options: { seed: 1, arrayLength: 4 },
  },
  {
    id: 'tuple',
    pins: 'a tuple takes its arity from itself, and ignores arrayLength',
    shape: {
      kind: 'tuple',
      items: [primitive('number'), primitive('number'), primitive('string')],
    },
    options: { seed: 1, arrayLength: 7 },
  },
  {
    id: 'tuple-empty',
    pins: 'an empty tuple is an empty array',
    shape: { kind: 'tuple', items: [] },
    options: { seed: 1 },
  },
  {
    id: 'record',
    pins: 'THE record fact: the key count is fixed, and does not follow arrayLength',
    shape: { kind: 'record', values: primitive('string') },
    options: { seed: 1, arrayLength: 7 },
  },
  {
    id: 'record-of-objects',
    pins: 'a record value carries no field name into its own fields',
    shape: {
      kind: 'record',
      values: {
        kind: 'object',
        fields: [{ name: 'email', shape: primitive('string'), optional: false }],
      },
    },
    options: { seed: 1 },
  },
  {
    id: 'nested-four-levels',
    pins: 'nesting order: the whole tree is walked depth-first, left to right',
    shape: {
      kind: 'object',
      fields: [
        {
          name: 'level1',
          optional: false,
          shape: {
            kind: 'object',
            fields: [
              {
                name: 'level2',
                optional: false,
                shape: {
                  kind: 'array',
                  items: {
                    kind: 'object',
                    fields: [
                      {
                        name: 'level3',
                        optional: true,
                        shape: {
                          kind: 'tuple',
                          items: [primitive('integer'), { kind: 'literals', values: ['x', 'y'] }],
                        },
                      },
                    ],
                  },
                },
              },
            ],
          },
        },
      ],
    },
    options: { seed: 1, arrayLength: 2 },
  },
  {
    id: 'seed-2-object',
    pins: 'a second seed over the same shape, so a seed-handling change is visible',
    shape: {
      kind: 'object',
      fields: [
        { name: 'id', shape: primitive('integer'), optional: false },
        { name: 'name', shape: primitive('string'), optional: false },
        { name: 'createdAt', shape: primitive('date'), optional: false },
        { name: 'price', shape: primitive('number'), optional: false },
        { name: 'active', shape: primitive('boolean'), optional: false },
      ],
    },
    options: { seed: 2 },
  },
]

export type ExampleCase = { id: ExampleModelId; options: GenerateOptions }

/**
 * The four example models, parsed and then generated. Each contributes two
 * goldens: the parsed `Shape` and the body generated from it. Pinning the
 * Shape separately means phase 2 can read the oracle without loading the
 * 23 MB TypeScript compiler, and a parser regression is told apart from a
 * generator regression.
 */
export const EXAMPLE_CASES: readonly ExampleCase[] = [
  { id: 'simple', options: { seed: 7 } },
  { id: 'medium', options: { seed: 7 } },
  { id: 'complex', options: { seed: 7, arrayLength: 2 } },
  { id: 'flat', options: { seed: 7 } },
]

/** Where a golden lives. One place, so the test and any future reader agree. */
export function goldenPath(name: string): URL {
  return new URL(`../goldens/${name}.json`, import.meta.url)
}
