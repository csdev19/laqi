import { describe, expect, it } from 'vitest'
import { primitive, type Shape } from './shape'
import { packShape, unpackShape } from './recipe'

const invoice: Shape = {
  kind: 'object',
  fields: [
    { name: 'id', optional: false, shape: primitive('string') },
    { name: 'status', optional: false, shape: { kind: 'literals', values: ['draft', 'paid'] } },
    {
      name: 'coordinates',
      optional: true,
      shape: { kind: 'tuple', items: [primitive('number'), primitive('number')] },
    },
  ],
}

describe('generation recipes', () => {
  it('round-trips every generation rule through compact JSON', () => {
    const recipe = packShape(invoice)
    expect(recipe).toEqual([
      'o',
      [
        ['id', 0, 's'],
        ['status', 0, ['l', ['draft', 'paid']]],
        ['coordinates', 1, ['t', ['n', 'n']]],
      ],
    ])
    expect(unpackShape(recipe)).toEqual({ ok: true, shape: invoice })
  })

  it('rejects a hand-edited malformed recipe before it reaches generation', () => {
    expect(unpackShape(['o', [['id', 2, 's']]])).toEqual({
      ok: false,
      error: 'object recipe field id has invalid optionality',
    })
  })
})
