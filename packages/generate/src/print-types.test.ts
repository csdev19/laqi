import { describe, expect, it } from 'vitest'
import { printTypes, supportedLanguages } from './print-types'
import { primitive, type Shape } from './shape'

const user: Shape = {
  kind: 'object',
  fields: [
    { name: 'id', shape: primitive('integer'), optional: false },
    { name: 'nick', shape: primitive('string'), optional: true },
    {
      name: 'tags',
      shape: { kind: 'array', items: { kind: 'literals', values: ['a', 'b'] } },
      optional: false,
    },
    {
      name: 'address',
      shape: {
        kind: 'object',
        fields: [{ name: 'street', shape: primitive('string'), optional: false }],
      },
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

  it('degrades a tuple to a union-typed array instead of crashing or losing the field (quicktype has no per-position tuple rendering — see the comment on printTypesEffect)', async () => {
    const boxed: Shape = {
      kind: 'object',
      fields: [
        {
          name: 'pair',
          shape: { kind: 'tuple', items: [primitive('string'), primitive('number')] },
          optional: false,
        },
      ],
    }
    const { code } = await printTypes(boxed, { typeName: 'Box' })
    expect(code).toContain('export interface Box')
    expect(code).toMatch(/pair/)
    // Not a crash, not an empty/omitted field — some array-ish, union-ish
    // rendering of both element types is present.
    expect(code).toMatch(/number/)
    expect(code).toMatch(/string/)
  })

  // Plan 6 audit, finding 8: a `[]` body is `array<unknown>`, which
  // quicktype prints as nothing — no declaration, no error — so Copy types
  // put an empty string on the clipboard with a 200.
  describe('a root quicktype cannot name', () => {
    const emptyBody: Shape = { kind: 'array', items: { kind: 'unknown' } }

    it('fails with a message instead of printing an empty string', async () => {
      await expect(printTypes(emptyBody, { typeName: 'Todos' })).rejects.toThrow(
        /printed no declaration for Todos.*empty array/s,
      )
    }, 30_000)

    it('fails the same way where quicktype prints only an import line', async () => {
      await expect(
        printTypes(emptyBody, { typeName: 'Todos', lang: 'typescript-zod' }),
      ).rejects.toThrow(/printed no declaration for Todos/)
    }, 30_000)

    it('still prints an empty array nested inside an object', async () => {
      const shape: Shape = {
        kind: 'object',
        fields: [{ name: 'items', shape: emptyBody, optional: false }],
      }
      const { code } = await printTypes(shape, { typeName: 'Todos' })
      expect(code).toContain('Todos')
      expect(code).toContain('items')
    }, 30_000)
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
    for (const expected of [
      'typescript',
      'typescript-zod',
      'swift',
      'kotlin',
      'dart',
      'python',
      'go',
    ]) {
      expect(names).toContain(expected)
    }
  })
})
