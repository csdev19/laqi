import { describe, expect, it } from 'vitest'
import { shapeToJsonSchema } from './json-schema'
import { primitive, type Shape } from './shape'

describe('shapeToJsonSchema', () => {
  it('maps an object with optionals to properties + required + closed', () => {
    const shape: Shape = {
      kind: 'object',
      fields: [
        { name: 'id', shape: primitive('integer'), optional: false },
        { name: 'nick', shape: primitive('string'), optional: true },
      ],
    }
    expect(shapeToJsonSchema(shape)).toEqual({
      type: 'object',
      properties: { id: { type: 'integer' }, nick: { type: 'string' } },
      required: ['id'],
      // Without this, quicktype's TS output grows an index signature.
      additionalProperties: false,
    })
  })

  it('maps arrays, records, literals, dates and unknown', () => {
    expect(shapeToJsonSchema({ kind: 'array', items: primitive('string') })).toEqual({
      type: 'array',
      items: { type: 'string' },
    })
    expect(shapeToJsonSchema({ kind: 'record', values: primitive('number') })).toEqual({
      type: 'object',
      additionalProperties: { type: 'number' },
    })
    expect(shapeToJsonSchema({ kind: 'literals', values: ['a', 'b'] })).toEqual({ enum: ['a', 'b'] })
    expect(shapeToJsonSchema(primitive('date'))).toEqual({ type: 'string', format: 'date-time' })
    expect(shapeToJsonSchema(primitive('null'))).toEqual({ type: 'null' })
    expect(shapeToJsonSchema({ kind: 'unknown' })).toEqual({})
  })

  it('maps a tuple to the 2020-12 prefixItems form, closed against extra items', () => {
    const shape: Shape = { kind: 'tuple', items: [primitive('string'), primitive('number')] }
    expect(shapeToJsonSchema(shape)).toEqual({
      type: 'array',
      prefixItems: [{ type: 'string' }, { type: 'number' }],
      items: false,
      minItems: 2,
      maxItems: 2,
    })
  })

  it('maps an empty tuple the same way an empty-tuple Shape ever appears — as an array of unknown', () => {
    // parseTypes never emits `{kind:'tuple', items:[]}` (it emits
    // `{kind:'array', items:{kind:'unknown'}}` for `[]`), but the mapping
    // must still be sane if one is ever constructed by hand.
    expect(shapeToJsonSchema({ kind: 'tuple', items: [] })).toEqual({
      type: 'array',
      prefixItems: [],
      items: false,
      minItems: 0,
      maxItems: 0,
    })
  })
})
