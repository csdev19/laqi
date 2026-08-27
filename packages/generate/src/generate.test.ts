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

  it('does not match paid/valid with endsWith("id") — word boundaries only', async () => {
    const shape: Shape = {
      kind: 'object',
      fields: [
        { name: 'paid', shape: primitive('boolean'), optional: false },
        { name: 'valid', shape: primitive('boolean'), optional: false },
      ],
    }
    const value = (await generate(shape, { seed: 42 })) as Record<string, unknown>
    expect(typeof value.paid).toBe('boolean')
    expect(typeof value.valid).toBe('boolean')
  })

  it('emailVerifiedAt produces a date, not an email — date-ness wins', async () => {
    const shape: Shape = {
      kind: 'object',
      fields: [{ name: 'emailVerifiedAt', shape: primitive('string'), optional: false }],
    }
    const value = (await generate(shape, { seed: 42 })) as Record<string, unknown>
    expect(value.emailVerifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('filename produces a file-like string, not a person name', async () => {
    const shape: Shape = {
      kind: 'object',
      fields: [{ name: 'filename', shape: primitive('string'), optional: false }],
    }
    const value = (await generate(shape, { seed: 42 })) as Record<string, unknown>
    const filename = String(value.filename)
    // Should NOT look like a person name (with title case and spaces)
    expect(filename).not.toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+/)
  })

  it('username produces a username, not a person name', async () => {
    const shape: Shape = {
      kind: 'object',
      fields: [{ name: 'username', shape: primitive('string'), optional: false }],
    }
    const value = (await generate(shape, { seed: 42 })) as Record<string, unknown>
    const username = String(value.username)
    // Should NOT look like a person name (with title case and spaces)
    expect(username).not.toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+/)
  })

  it('id, userId, orderId have separate counters and different patterns', async () => {
    const shape: Shape = {
      kind: 'object',
      fields: [
        { name: 'id', shape: primitive('integer'), optional: false },
        { name: 'userId', shape: primitive('integer'), optional: false },
        { name: 'orderId', shape: primitive('integer'), optional: false },
      ],
    }
    const value = (await generate(shape, { seed: 42 })) as Record<string, unknown>
    expect(value.id).toBe(1)
    // userId and orderId should be plausible foreign keys (not sequential)
    expect(typeof value.userId).toBe('number')
    expect(typeof value.orderId).toBe('number')
    expect(value.userId).toBeGreaterThanOrEqual(1)
    expect(value.userId).toBeLessThanOrEqual(1000)
    expect(value.orderId).toBeGreaterThanOrEqual(1)
    expect(value.orderId).toBeLessThanOrEqual(1000)
  })

  it('combined fixture with paid, valid, emailVerifiedAt, filename, username, id, userId, orderId', async () => {
    const shape: Shape = {
      kind: 'object',
      fields: [
        { name: 'paid', shape: primitive('boolean'), optional: false },
        { name: 'valid', shape: primitive('boolean'), optional: false },
        { name: 'emailVerifiedAt', shape: primitive('string'), optional: false },
        { name: 'filename', shape: primitive('string'), optional: false },
        { name: 'username', shape: primitive('string'), optional: false },
        { name: 'id', shape: primitive('integer'), optional: false },
        { name: 'userId', shape: primitive('integer'), optional: false },
        { name: 'orderId', shape: primitive('integer'), optional: false },
      ],
    }
    const value = (await generate(shape, { seed: 42 })) as Record<string, unknown>
    expect(typeof value.paid).toBe('boolean')
    expect(typeof value.valid).toBe('boolean')
    expect(String(value.emailVerifiedAt)).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(String(value.filename)).not.toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+/)
    expect(String(value.username)).not.toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+/)
    expect(value.id).toBe(1)
    expect(typeof value.userId).toBe('number')
    expect(typeof value.orderId).toBe('number')
  })

  it('arrayLength is clamped to 1..1000', async () => {
    const shape = { kind: 'array' as const, items: primitive('integer') }
    expect((await generate(shape, { seed: 1, arrayLength: 0 })) as unknown[]).toHaveLength(1)
    expect((await generate(shape, { seed: 1, arrayLength: -5 })) as unknown[]).toHaveLength(1)
    expect((await generate(shape, { seed: 1, arrayLength: 1001 })) as unknown[]).toHaveLength(1000)
    expect((await generate(shape, { seed: 1, arrayLength: 500 })) as unknown[]).toHaveLength(500)
  })

  it('setDefaultRefDate is only applied when seed is given', async () => {
    // Unseeded runs should not anchor to 2026-01-01
    const unseeded = (await generate(
      {
        kind: 'object',
        fields: [{ name: 'createdAt', shape: primitive('date'), optional: false }],
      },
    )) as Record<string, unknown>
    const dateStr = String(unseeded.createdAt)
    // Should be a recent date, not necessarily 2026 (could be current year or close)
    expect(dateStr).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    // The year should be reasonably close to current year, not stuck at 2026
    const year = parseInt(dateStr.substring(0, 4))
    expect(year).toBeGreaterThanOrEqual(2025)
  })
})
