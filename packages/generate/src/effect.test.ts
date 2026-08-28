import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import { generate, generateEffect } from './generate'
import { parseTypes, parseTypesEffect } from './parse-types'
import type { Shape } from './shape'
import { primitive } from './shape'

const VALID_SOURCE = `export interface User { id: number; name: string }`
const INVALID_SOURCE = 'const x = 1'

const user: Shape = {
  kind: 'object',
  fields: [
    { name: 'id', shape: primitive('integer'), optional: false },
    { name: 'name', shape: primitive('string'), optional: false },
  ],
}

describe('parseTypesEffect', () => {
  it('succeeds on a valid interface', async () => {
    const result = await Effect.runPromise(parseTypesEffect(VALID_SOURCE))
    expect(result.shape.kind).toBe('object')
    expect(result.typeName).toBe('User')
    expect(result.warnings).toEqual([])
  })

  it('fails with a tagged error catchable via catchTag', async () => {
    const caught = await Effect.runPromise(
      parseTypesEffect(INVALID_SOURCE).pipe(
        Effect.catchTag('ParseError', (e) => Effect.succeed(`caught: ${e.message}`)),
      ),
    )
    expect(caught).toMatch(/no interface or type alias/)
  })

  it('rejects the raw promise with the typed error message when uncaught', async () => {
    await expect(Effect.runPromise(parseTypesEffect(INVALID_SOURCE))).rejects.toThrow(
      /no interface/,
    )
  })

  it('facade equivalence: parseTypes matches the hand-built {ok,...} mapping for good and bad sources', async () => {
    for (const source of [VALID_SOURCE, INVALID_SOURCE]) {
      const facadeResult = await parseTypes(source)
      const handBuilt = await Effect.runPromise(
        parseTypesEffect(source).pipe(
          Effect.map((value) => ({ ok: true as const, ...value })),
          Effect.catchTag('ParseError', (e) =>
            Effect.succeed({ ok: false as const, error: e.message }),
          ),
        ),
      )
      expect(facadeResult).toEqual(handBuilt)
    }
  })
})

describe('generateEffect', () => {
  it('is byte-reproducible under a seed through the Effect program', async () => {
    const a = await Effect.runPromise(generateEffect(user, { seed: 42 }))
    const b = await Effect.runPromise(generateEffect(user, { seed: 42 }))
    expect(a).toEqual(b)
  })

  it('the generate facade returns plain JSON-serialisable data', async () => {
    const value = await generate(user, { seed: 42 })
    expect(JSON.parse(JSON.stringify(value))).toEqual(value)
  })
})
