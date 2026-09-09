import { describe, expect, it } from 'vitest'
import { formatJson } from './json-layout'

describe('what formatJson keeps identical to JSON.stringify', () => {
  it('parses back to the same value, for every shape a mock file holds', () => {
    const values: unknown[] = [
      {},
      [],
      { a: 1 },
      { a: [1, 2, 3], b: { c: 'x' } },
      { 'a "quoted" key': 'a \\ value\nwith\tcontrol chars' },
      { unicode: 'año — ✅' },
      [{ a: 1 }, { a: 2 }],
      { nested: { deep: { deeper: [true, false, null] } } },
      { big: 1e21, small: 1e-7, negative: -0.5 },
    ]
    for (const value of values) {
      expect(JSON.parse(formatJson(value)), JSON.stringify(value)).toEqual(
        JSON.parse(JSON.stringify(value)),
      )
    }
  })

  it('escapes exactly as JSON.stringify does', () => {
    const tricky = { key: 'quote " backslash \\ newline \n tab \t end' }
    expect(formatJson(tricky)).toContain(JSON.stringify(tricky.key))
  })

  it('keeps object key order', () => {
    expect(formatJson({ zeta: 1, alpha: 2, mid: 3 })).toBe(
      '{\n  "zeta": 1,\n  "alpha": 2,\n  "mid": 3\n}',
    )
  })

  it('drops an undefined member, as writing it would', () => {
    expect(formatJson({ a: 1, b: undefined })).toBe('{\n  "a": 1\n}')
  })
})

describe('what stays on one line', () => {
  it('writes an empty array or object inline', () => {
    expect(formatJson({ a: [], b: {} })).toBe('{\n  "a": [],\n  "b": {}\n}')
  })

  it('writes an array of scalars on one line when it fits', () => {
    expect(formatJson({ required: ['id', 'name', 'email'] })).toBe(
      '{\n  "required": ["id", "name", "email"]\n}',
    )
  })

  it('collapses the enum and required lists a schema document is mostly made of', () => {
    const document = {
      type: 'object',
      properties: { status: { enum: ['draft', 'issued', 'paid', 'void'] } },
      required: ['status'],
    }
    expect(formatJson(document)).toBe(
      [
        '{',
        '  "type": "object",',
        '  "properties": {',
        '    "status": {',
        '      "enum": ["draft", "issued", "paid", "void"]',
        '    }',
        '  },',
        '  "required": ["status"]',
        '}',
      ].join('\n'),
    )
  })
})

describe('what expands', () => {
  it('expands a scalar array whose line would pass 100 columns', () => {
    const short = { tags: Array.from({ length: 8 }, (_, i) => `tag-${i}`) }
    const long = { tags: Array.from({ length: 20 }, (_, i) => `tag-${i}`) }
    expect(formatJson(short)).not.toContain('\n    "tag-0"')
    expect(formatJson(long)).toContain('\n    "tag-0",')
  })

  it('counts the indent, so the same array expands deeper in the tree', () => {
    const row = ['aaaaaaaaaa', 'bbbbbbbbbb', 'cccccccccc', 'dddddddddd', 'eeeeeeeeee', 'ffffffff']
    expect(formatJson({ row }).split('\n')).toHaveLength(3)
    const deep = { a: { b: { c: { d: { e: { row } } } } } }
    expect(formatJson(deep)).toContain('\n              "aaaaaaaaaa",')
  })

  it('expands an array holding anything that is not a scalar', () => {
    expect(formatJson({ a: [{ b: 1 }] })).toBe('{\n  "a": [\n    {\n      "b": 1\n    }\n  ]\n}')
    expect(formatJson({ a: [[1]] })).toBe('{\n  "a": [\n    [1]\n  ]\n}')
  })

  it('expands an object with members, however short', () => {
    expect(formatJson({ a: { b: 1 } })).toBe('{\n  "a": {\n    "b": 1\n  }\n}')
  })
})

describe('the top level', () => {
  it('writes a bare scalar as itself', () => {
    expect(formatJson('x')).toBe('"x"')
    expect(formatJson(null)).toBe('null')
    expect(formatJson(7)).toBe('7')
  })

  it('writes a top-level scalar array on one line when it fits', () => {
    expect(formatJson([1, 2, 3])).toBe('[1, 2, 3]')
  })
})
