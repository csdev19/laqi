import { describe, expect, it } from 'vitest'
import { printTypes, supportedLanguages } from './print-types'
import { primitive, type Shape } from './shape'

const user: Shape = {
  kind: 'object',
  fields: [
    { name: 'id', shape: primitive('integer'), optional: false },
    { name: 'nick', shape: primitive('string'), optional: true },
    { name: 'tags', shape: { kind: 'array', items: { kind: 'literals', values: ['a', 'b'] } }, optional: false },
    {
      name: 'address',
      shape: { kind: 'object', fields: [{ name: 'street', shape: primitive('string'), optional: false }] },
      optional: false,
    },
  ],
}

describe('printTypes', () => {
  it('emits a TypeScript interface with named nested types, no index signature', async () => {
    const { code } = await printTypes(user, { typeName: 'User' })
    expect(code).toContain('export interface User')
    expect(code).toContain('nick?')
    expect(code).toContain('Address')
    expect(code).not.toContain('[property: string]')
  })

  it('emits Zod schemas when asked', async () => {
    const { code, language } = await printTypes(user, { typeName: 'User', lang: 'typescript-zod' })
    expect(language).toBe('typescript-zod')
    expect(code).toContain('z.object')
    expect(code).toContain('z.enum')
  })

  it('rejects an unknown language naming the real ones', async () => {
    await expect(printTypes(user, { typeName: 'User', lang: 'cobol' })).rejects.toThrow(/cobol/)
  })

  it('smoke-emits every advertised language', async () => {
    // Deep assertions only for TS and Zod; the rest must at least emit
    // non-empty code without throwing.
    for (const { name } of await supportedLanguages()) {
      const { code } = await printTypes(user, { typeName: 'User', lang: name })
      expect(code.length, name).toBeGreaterThan(20)
    }
  }, 120_000)
})

describe('supportedLanguages', () => {
  it('advertises the well-known ones', async () => {
    const names = (await supportedLanguages()).map((l) => l.name)
    for (const expected of ['typescript', 'typescript-zod', 'swift', 'kotlin', 'dart', 'python', 'go']) {
      expect(names).toContain(expected)
    }
  })
})
