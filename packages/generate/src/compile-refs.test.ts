import { describe, expect, it } from 'vitest'
import { compileSchema } from './compile-schema'
import { generateFromPlan } from './plan'

const compiled = (document: unknown) => {
  const result = compileSchema(document)
  if (!result.ok) throw new Error(`refused: ${JSON.stringify(result.diagnostics)}`)
  return result
}

describe('$ref within the document', () => {
  it('resolves a pointer into $defs', () => {
    expect(
      compiled({
        $defs: { Money: { type: 'number' } },
        type: 'object',
        properties: { total: { $ref: '#/$defs/Money' } },
        required: ['total'],
      }).plan,
    ).toEqual({
      kind: 'object',
      fields: [{ name: 'total', plan: { kind: 'primitive', type: 'number' }, optional: false }],
    })
  })

  it('resolves the older definitions spelling too', () => {
    expect(
      compiled({ definitions: { A: { type: 'string' } }, $ref: '#/definitions/A' }).plan,
    ).toEqual({ kind: 'primitive', type: 'string' })
  })

  it('resolves a pointer to anywhere in the document, not only to a definition', () => {
    expect(
      compiled({
        type: 'object',
        properties: { a: { type: 'boolean' }, b: { $ref: '#/properties/a' } },
        required: ['a', 'b'],
      }).plan,
    ).toMatchObject({
      fields: [{ name: 'a' }, { name: 'b', plan: { kind: 'primitive', type: 'boolean' } }],
    })
  })

  it('unescapes ~1 and ~0 in a pointer, so a property with a slash resolves', () => {
    expect(
      compiled({ $defs: { 'a/b~c': { type: 'integer' } }, $ref: '#/$defs/a~1b~0c' }).plan,
    ).toEqual({ kind: 'primitive', type: 'integer' })
  })

  it('resolves the same definition twice without complaint, since sharing is not a cycle', () => {
    expect(
      compiled({
        $defs: { Id: { type: 'string' } },
        type: 'object',
        properties: { a: { $ref: '#/$defs/Id' }, b: { $ref: '#/$defs/Id' } },
        required: ['a', 'b'],
      }).diagnostics,
    ).toEqual([])
  })
})

describe('a $ref laqi will not follow', () => {
  it('refuses one that points outside the document, without reaching for the network', () => {
    const result = compileSchema({ $ref: 'https://example.test/invoice.json' })
    expect(result.ok).toBe(false)
    expect(result.diagnostics[0]?.code).toBe('unsupported.keyword')
    expect(result.diagnostics[0]?.message).toContain('https://example.test/invoice.json')
  })

  it('refuses a relative file reference for the same reason', () => {
    expect(compileSchema({ $ref: 'common.json#/$defs/A' }).diagnostics[0]?.code).toBe(
      'unsupported.keyword',
    )
  })

  it('refuses a pointer that resolves to nothing, naming it', () => {
    const result = compileSchema({ $defs: {}, $ref: '#/$defs/Missing' })
    expect(result.ok).toBe(false)
    expect(result.diagnostics[0]?.code).toBe('invalid.document')
    expect(result.diagnostics[0]?.message).toContain('#/$defs/Missing')
  })
})

describe('a cycle', () => {
  const selfReferencing = {
    $defs: {
      Node: {
        type: 'object',
        properties: { name: { type: 'string' }, next: { $ref: '#/$defs/Node' } },
        required: ['name', 'next'],
      },
    },
    $ref: '#/$defs/Node',
  }

  it('is cut where it closes, rather than followed', () => {
    const result = compiled(selfReferencing)
    expect(result.plan).toEqual({
      kind: 'object',
      fields: [
        { name: 'name', plan: { kind: 'primitive', type: 'string' }, optional: false },
        { name: 'next', plan: { kind: 'unknown' }, optional: false },
      ],
    })
  })

  it('reports the cut as loss, because the document said more than the plan carries', () => {
    const result = compiled(selfReferencing)
    expect(result.diagnostics.map((d) => d.code)).toEqual(['loss.circular'])
    expect(result.diagnostics[0]?.pointer).toBe('/properties/next')
  })

  it('generates a finite body from the cut plan', async () => {
    const body = await generateFromPlan(compiled(selfReferencing).plan, { seed: 1 })
    expect(body).toMatchObject({ next: null })
  })

  it('cuts a cycle that closes through two definitions', () => {
    const result = compiled({
      $defs: {
        A: { type: 'object', properties: { b: { $ref: '#/$defs/B' } }, required: ['b'] },
        B: { type: 'object', properties: { a: { $ref: '#/$defs/A' } }, required: ['a'] },
      },
      $ref: '#/$defs/A',
    })
    expect(result.plan).toEqual({
      kind: 'object',
      fields: [
        {
          name: 'b',
          optional: false,
          plan: {
            kind: 'object',
            fields: [{ name: 'a', plan: { kind: 'unknown' }, optional: false }],
          },
        },
      ],
    })
    expect(result.diagnostics.map((d) => d.code)).toEqual(['loss.circular'])
  })
})
