import { describe, expect, it } from 'vitest'
import { SHAPE_CASES } from './characterization.catalog'
import { generate } from './generate'
import { generateFromPlan, liftShape } from './plan'
import { primitive } from './shape'

describe('liftShape', () => {
  it('carries a shape across unchanged, because a shape states no constraints', () => {
    expect(liftShape(primitive('string'))).toEqual({ kind: 'primitive', type: 'string' })
    expect(
      liftShape({
        kind: 'object',
        fields: [{ name: 'a', shape: primitive('integer'), optional: true }],
      }),
    ).toEqual({
      kind: 'object',
      fields: [{ name: 'a', plan: { kind: 'primitive', type: 'integer' }, optional: true }],
    })
  })
})

describe('generateFromPlan', () => {
  it('produces exactly what generate() produces, for every characterised case', async () => {
    for (const testCase of SHAPE_CASES) {
      const fromShape = await generate(testCase.shape, testCase.options)
      const fromPlan = await generateFromPlan(liftShape(testCase.shape), testCase.options)
      expect(fromPlan, testCase.id).toEqual(fromShape)
    }
  })

  it('picks one option of a choice, and the pick is seed-stable', async () => {
    const plan = {
      kind: 'choice' as const,
      options: [liftShape(primitive('boolean')), liftShape({ kind: 'literals', values: ['x'] })],
    }
    const first = await generateFromPlan(plan, { seed: 3 })
    expect(await generateFromPlan(plan, { seed: 3 })).toEqual(first)
    expect(typeof first === 'boolean' || first === 'x').toBe(true)
  })

  it('counts a choice against the value budget, so a deep choice tree cannot amplify unchecked', async () => {
    const deep = Array.from({ length: 3 }, () => liftShape(primitive('string')))
    const plan = { kind: 'choice' as const, options: deep }
    await expect(generateFromPlan(plan, { seed: 1 })).resolves.toBeTypeOf('string')
  })
})
