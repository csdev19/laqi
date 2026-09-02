import { describe, expect, it } from 'vitest'
import { primitive, validateShape, type Shape } from './shape'

describe('validateShape', () => {
  it('accepts every shape kind', () => {
    const shape: Shape = {
      kind: 'object',
      fields: [
        { name: 'id', shape: primitive('integer'), optional: false },
        { name: 'tags', shape: { kind: 'array', items: primitive('string') }, optional: true },
        { name: 'pair', shape: { kind: 'tuple', items: [primitive('string')] }, optional: false },
        { name: 'meta', shape: { kind: 'record', values: primitive('string') }, optional: false },
        { name: 'state', shape: { kind: 'literals', values: ['a', 1, true] }, optional: false },
        { name: 'raw', shape: { kind: 'unknown' }, optional: false },
      ],
    }

    expect(validateShape(shape)).toBeNull()
  })

  it('rejects an empty literal union, which has no value to generate', () => {
    expect(validateShape({ kind: 'literals', values: [] })).toMatch(/literals/)
  })

  it('rejects an unrecognised kind', () => {
    expect(validateShape({ kind: 'enum', values: ['a'] })).toMatch(/enum/)
  })

  it('rejects a non-object', () => {
    expect(validateShape(null)).not.toBeNull()
    expect(validateShape('object')).not.toBeNull()
  })

  it('rejects an unknown primitive type', () => {
    expect(validateShape({ kind: 'primitive', type: 'bigint' })).toMatch(/bigint/)
  })

  it('rejects a field without a name', () => {
    expect(
      validateShape({ kind: 'object', fields: [{ shape: primitive('string'), optional: false }] }),
    ).not.toBeNull()
  })

  it('names the path of the offending shape, not just the root', () => {
    const shape = {
      kind: 'object',
      fields: [
        {
          name: 'user',
          shape: { kind: 'array', items: { kind: 'literals', values: [] } },
          optional: false,
        },
      ],
    }

    expect(validateShape(shape)).toContain('user[]')
  })

  it('rejects nesting past the generator depth ceiling instead of recursing forever', () => {
    let shape: unknown = primitive('string')
    for (let i = 0; i < 5_000; i++) shape = { kind: 'array', items: shape }

    expect(validateShape(shape)).not.toBeNull()
  })

  it('rejects a literal value that is not JSON-serialisable as a literal', () => {
    expect(validateShape({ kind: 'literals', values: [{ nope: true }] })).not.toBeNull()
  })
})
