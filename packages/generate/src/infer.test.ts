import { describe, expect, it } from 'vitest'
import { inferShape, mergeShapes } from './infer'
import { primitive } from './shape'

describe('inferShape', () => {
  it('infers primitives, telling integers from floats', () => {
    expect(inferShape('hi')).toEqual(primitive('string'))
    expect(inferShape(3)).toEqual(primitive('integer'))
    expect(inferShape(3.5)).toEqual(primitive('number'))
    expect(inferShape(true)).toEqual(primitive('boolean'))
    expect(inferShape(null)).toEqual(primitive('null'))
  })

  it('recognises ISO date strings as dates', () => {
    expect(inferShape('2026-08-27T10:00:00.000Z')).toEqual(primitive('date'))
    expect(inferShape('2026-08-27')).toEqual(primitive('date'))
    // Not a date: a plain string that merely contains digits.
    expect(inferShape('order-2026')).toEqual(primitive('string'))
  })

  it('infers objects with their fields in source order', () => {
    expect(inferShape({ id: 1, name: 'Ada' })).toEqual({
      kind: 'object',
      fields: [
        { name: 'id', shape: primitive('integer'), optional: false },
        { name: 'name', shape: primitive('string'), optional: false },
      ],
    })
  })

  it('merges array items: a field missing in some items becomes optional', () => {
    const shape = inferShape([{ id: 1, tag: 'a' }, { id: 2 }])
    expect(shape).toEqual({
      kind: 'array',
      items: {
        kind: 'object',
        fields: [
          { name: 'id', shape: primitive('integer'), optional: false },
          { name: 'tag', shape: primitive('string'), optional: true },
        ],
      },
    })
  })

  it('widens integer + float to number when merging', () => {
    const shape = inferShape([{ v: 1 }, { v: 2.5 }])
    expect(shape).toEqual({
      kind: 'array',
      items: {
        kind: 'object',
        fields: [{ name: 'v', shape: primitive('number'), optional: false }],
      },
    })
  })

  it('treats null-or-X as X when merging (null adds nothing to generate from)', () => {
    const shape = inferShape([{ v: null }, { v: 'x' }])
    expect(shape).toEqual({
      kind: 'array',
      items: {
        kind: 'object',
        fields: [{ name: 'v', shape: primitive('string'), optional: false }],
      },
    })
  })

  it('gives an empty array unknown items', () => {
    expect(inferShape([])).toEqual({ kind: 'array', items: { kind: 'unknown' } })
  })

  it('falls back to unknown when kinds genuinely conflict', () => {
    const shape = inferShape([{ v: 1 }, { v: { nested: true } }])
    expect(shape).toEqual({
      kind: 'array',
      items: {
        kind: 'object',
        fields: [{ name: 'v', shape: { kind: 'unknown' }, optional: false }],
      },
    })
  })

  // inferShape reads JSON, where a tuple is indistinguishable from an array
  // — it never produces a `tuple` shape on its own. But mergeShapes must
  // still be total: a `tuple` can reach it from a hand-built Shape (e.g.
  // one that started life via parseTypes) being merged against JSON-derived
  // data, and it must not crash.
  describe('depth guard', () => {
    it('throws a clean, explained error on pathological nesting instead of blowing the stack', () => {
      let value: unknown = 'leaf'
      for (let i = 0; i < 50_000; i++) value = { child: value }

      let caught: unknown
      try {
        inferShape(value)
      } catch (error) {
        caught = error
      }

      expect(caught).toBeInstanceOf(Error)
      expect(caught).not.toBeInstanceOf(RangeError)
      expect((caught as Error).message).toMatch(/nesting|depth/i)
    })
  })

  describe('mergeShapes with a tuple', () => {
    it('is total: never throws when one or both sides are a tuple', () => {
      const tuple = { kind: 'tuple' as const, items: [primitive('string'), primitive('number')] }
      expect(() => mergeShapes(tuple, primitive('string'))).not.toThrow()
      expect(() => mergeShapes(primitive('string'), tuple)).not.toThrow()
      expect(() => mergeShapes(tuple, { kind: 'array', items: primitive('string') })).not.toThrow()
      expect(() => mergeShapes(tuple, tuple)).not.toThrow()
      expect(() => mergeShapes(tuple, { kind: 'unknown' })).not.toThrow()
    })

    it('defers to unknown deferring rules: unknown widens to the tuple', () => {
      const tuple = { kind: 'tuple' as const, items: [primitive('string'), primitive('number')] }
      expect(mergeShapes(tuple, { kind: 'unknown' })).toEqual(tuple)
      expect(mergeShapes({ kind: 'unknown' }, tuple)).toEqual(tuple)
    })
  })
})
