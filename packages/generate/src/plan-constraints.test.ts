import { describe, expect, it } from 'vitest'
import { generateFromPlan, type Plan } from './plan'

const many = async (plan: Plan, runs = 40) => {
  const values: unknown[] = []
  for (let seed = 0; seed < runs; seed++) values.push(await generateFromPlan(plan, { seed }))
  return values
}

describe('a number with bounds', () => {
  it('stays inside them', async () => {
    const values = (await many({
      kind: 'primitive',
      type: 'number',
      number: { minimum: 10, maximum: 12 },
    })) as number[]
    for (const value of values) {
      expect(value).toBeGreaterThanOrEqual(10)
      expect(value).toBeLessThanOrEqual(12)
    }
  })

  it('honours the bounds even when the field name has a rule of its own', async () => {
    const values = (await many({
      kind: 'object',
      fields: [
        {
          name: 'price',
          optional: false,
          plan: { kind: 'primitive', type: 'number', number: { minimum: 1, maximum: 2 } },
        },
      ],
    })) as { price: number }[]
    for (const value of values) expect(value.price).toBeGreaterThanOrEqual(1)
    for (const value of values) expect(value.price).toBeLessThanOrEqual(2)
  })

  it('keeps an integer whole', async () => {
    const values = (await many({
      kind: 'primitive',
      type: 'integer',
      number: { minimum: 5, maximum: 9 },
    })) as number[]
    for (const value of values) expect(Number.isInteger(value)).toBe(true)
  })

  it('lands on a multiple of multipleOf', async () => {
    const values = (await many({
      kind: 'primitive',
      type: 'integer',
      number: { minimum: 0, maximum: 100, multipleOf: 25 },
    })) as number[]
    for (const value of values) expect(value % 25).toBe(0)
  })

  it('fails rather than inventing a value when the bounds admit none', async () => {
    await expect(
      generateFromPlan(
        { kind: 'primitive', type: 'integer', number: { minimum: 3, maximum: 3, multipleOf: 2 } },
        { seed: 1 },
      ),
    ).rejects.toThrow('no multiple of 2 lies between 3 and 3')
  })
})

describe('a string with a length or a format', () => {
  it('respects minLength and maxLength', async () => {
    const values = (await many({
      kind: 'primitive',
      type: 'string',
      text: { minLength: 4, maxLength: 6 },
    })) as string[]
    for (const value of values) {
      expect(value.length).toBeGreaterThanOrEqual(4)
      expect(value.length).toBeLessThanOrEqual(6)
    }
  })

  it('produces each format it claims to support', async () => {
    const shaped: Record<string, RegExp> = {
      date: /^\d{4}-\d{2}-\d{2}$/,
      email: /^[^@\s]+@[^@\s]+$/,
      uri: /^https?:\/\//,
      uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    }
    for (const [format, pattern] of Object.entries(shaped)) {
      const value = await generateFromPlan(
        { kind: 'primitive', type: 'string', text: { format: format as 'date' } },
        { seed: 4 },
      )
      expect(value, format).toMatch(pattern)
    }
  })
})

describe('an array with a length rule', () => {
  it('takes its length from the rule rather than from arrayLength', async () => {
    const plan: Plan = {
      kind: 'array',
      items: { kind: 'primitive', type: 'integer' },
      length: { min: 5, max: 5 },
    }
    expect(await generateFromPlan(plan, { seed: 1, arrayLength: 2 })).toHaveLength(5)
  })

  it('clamps the requested arrayLength into the rule', async () => {
    const plan: Plan = {
      kind: 'array',
      items: { kind: 'primitive', type: 'integer' },
      length: { min: 2, max: 4 },
    }
    expect(await generateFromPlan(plan, { seed: 1, arrayLength: 9 })).toHaveLength(4)
    expect(await generateFromPlan(plan, { seed: 1, arrayLength: 1 })).toHaveLength(2)
    expect(await generateFromPlan(plan, { seed: 1, arrayLength: 3 })).toHaveLength(3)
  })

  it('makes its items distinct when the rule says unique', async () => {
    const value = (await generateFromPlan(
      {
        kind: 'array',
        items: { kind: 'primitive', type: 'integer' },
        length: { min: 6, max: 6, unique: true },
      },
      { seed: 1 },
    )) as number[]
    expect(new Set(value).size).toBe(6)
  })

  it('fails rather than returning a short array when distinct values run out', async () => {
    await expect(
      generateFromPlan(
        {
          kind: 'array',
          items: { kind: 'primitive', type: 'boolean' },
          length: { min: 5, max: 5, unique: true },
        },
        { seed: 1 },
      ),
    ).rejects.toThrow(/distinct/i)
  })
})
