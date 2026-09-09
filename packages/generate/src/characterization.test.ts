import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { EXAMPLE_CASES, goldenPath, SHAPE_CASES } from './characterization.catalog'
import { exampleModel } from './examples'
import { generate } from './generate'
import { parseTypes } from './parse-types'

/**
 * Characterization, not specification. These tests describe what
 * `generate()` and `parseTypes()` do today, byte for byte, so that the JSON
 * Schema compiler can be held to the same output. A failure here means
 * behaviour moved; read the diff and decide whether the move was intended
 * before touching the golden.
 */

/** Goldens are committed as plain JSON so a reviewer reads data, not a snapshot format. */
async function pinTo(name: string, value: unknown): Promise<void> {
  await expect(`${JSON.stringify(value, null, 2)}\n`).toMatchFileSnapshot(
    fileURLToPath(goldenPath(name)),
  )
}

describe('generate() over every Shape variant', () => {
  for (const testCase of SHAPE_CASES) {
    it(`pins ${testCase.id} — ${testCase.pins}`, async () => {
      await pinTo(testCase.id, await generate(testCase.shape, testCase.options))
    })
  }

  it('covers every kind in the Shape union', () => {
    const covered = new Set(SHAPE_CASES.map((c) => c.shape.kind))
    expect([...covered].toSorted()).toEqual([
      'array',
      'literals',
      'object',
      'primitive',
      'record',
      'tuple',
      'unknown',
    ])
  })

  it('gives every case a distinct golden', () => {
    expect(new Set(SHAPE_CASES.map((c) => c.id)).size).toBe(SHAPE_CASES.length)
  })

  it('seeds every case, because an unseeded generate() is not reproducible', () => {
    expect(SHAPE_CASES.every((c) => Number.isInteger(c.options.seed))).toBe(true)
  })
})

describe('the example models, parsed and generated', () => {
  for (const testCase of EXAMPLE_CASES) {
    it(`pins the ${testCase.id} model`, { timeout: 30_000 }, async () => {
      const model = exampleModel(testCase.id)
      const parsed = await parseTypes(model.source, model.typeName)
      if (!parsed.ok) throw new Error(`${testCase.id} no longer parses: ${parsed.error}`)

      await pinTo(`example-${testCase.id}.shape`, parsed.shape)
      await pinTo(`example-${testCase.id}.body`, await generate(parsed.shape, testCase.options))
    })
  }
})
