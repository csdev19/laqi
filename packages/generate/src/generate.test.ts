import { describe, expect, it } from 'vitest'
import { generate } from './generate'
import { primitive, type Shape } from './shape'

const user: Shape = {
  kind: 'object',
  fields: [
    { name: 'id', shape: primitive('integer'), optional: false },
    { name: 'name', shape: primitive('string'), optional: false },
    { name: 'email', shape: primitive('string'), optional: false },
    { name: 'createdAt', shape: primitive('date'), optional: false },
    { name: 'price', shape: primitive('number'), optional: false },
    { name: 'tag', shape: { kind: 'literals', values: ['vip', 'regular'] }, optional: false },
    { name: 'active', shape: primitive('boolean'), optional: false },
  ],
}

describe('generate', () => {
  it('is byte-reproducible under a seed — including dates', async () => {
    // faker's date methods reference Date.now(); without a fixed refDate the
    // same seed produced different output (spike-verified). The seed contract
    // is what makes this snapshot-testable at all.
    const a = await generate(user, { seed: 42 })
    const b = await generate(user, { seed: 42 })
    expect(a).toEqual(b)
  })

  it('varies when the seed varies', async () => {
    expect(await generate(user, { seed: 1 })).not.toEqual(await generate(user, { seed: 2 }))
  })

  it('makes values that look like their field names', async () => {
    const value = (await generate(user, { seed: 42 })) as Record<string, unknown>
    expect(value.email).toMatch(/@/)
    expect(value.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(typeof value.price).toBe('number')
    expect(['vip', 'regular']).toContain(value.tag)
    expect(typeof value.active).toBe('boolean')
  })

  it('gives arrays sequential ids and the requested length', async () => {
    const list = (await generate(
      { kind: 'array', items: user },
      { seed: 42, arrayLength: 4 },
    )) as Record<string, unknown>[]
    expect(list).toHaveLength(4)
    expect(list.map((item) => item.id)).toEqual([1, 2, 3, 4])
  })

  it('defaults arrays to 3 items', async () => {
    expect((await generate({ kind: 'array', items: primitive('integer') }, { seed: 1 })) as unknown[]).toHaveLength(3)
  })

  it('always includes optional fields (generated data should show the full shape)', async () => {
    const shape: Shape = {
      kind: 'object',
      fields: [{ name: 'nick', shape: primitive('string'), optional: true }],
    }
    expect(Object.keys((await generate(shape, { seed: 1 })) as object)).toEqual(['nick'])
  })

  it('renders record, null and unknown sanely', async () => {
    const value = (await generate(
      {
        kind: 'object',
        fields: [
          { name: 'meta', shape: { kind: 'record', values: primitive('string') }, optional: false },
          { name: 'gone', shape: primitive('null'), optional: false },
          { name: 'mystery', shape: { kind: 'unknown' }, optional: false },
        ],
      },
      { seed: 1 },
    )) as Record<string, unknown>
    expect(Object.keys(value.meta as object).length).toBeGreaterThan(0)
    expect(value.gone).toBeNull()
    expect(value.mystery).toBeNull()
  })
})
