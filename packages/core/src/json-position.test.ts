import { describe, expect, it } from 'vitest'
import { buildExcerpt, offsetToPosition, parseJsonWithPosition } from './json-position'

const source = 'line one\nline two\nline three\n'

describe('offsetToPosition', () => {
  it('reports 1:1 at offset zero', () => {
    expect(offsetToPosition(source, 0)).toEqual({ line: 1, col: 1 })
  })

  it('reports the column within the first line', () => {
    expect(offsetToPosition(source, 5)).toEqual({ line: 1, col: 6 })
  })

  it('reports the start of the second line', () => {
    expect(offsetToPosition(source, 9)).toEqual({ line: 2, col: 1 })
  })

  it('clamps an offset past the end', () => {
    const position = offsetToPosition(source, 9999)
    expect(position.line).toBe(4)
  })
})

describe('buildExcerpt', () => {
  it('renders the line with its neighbours and a caret', () => {
    const excerpt = buildExcerpt(source, 2, 6)
    expect(excerpt).toContain('1 | line one')
    expect(excerpt).toContain('2 | line two')
    expect(excerpt).toContain('3 | line three')
    expect(excerpt).toContain('^')
  })

  it('does not run off the top of the file', () => {
    expect(buildExcerpt(source, 1, 1)).toContain('1 | line one')
  })
})

describe('parseJsonWithPosition', () => {
  it('returns the parsed value for valid JSON', () => {
    const result = parseJsonWithPosition('{"a":1}')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toEqual({ a: 1 })
  })

  it('reports line and column for a trailing comma', () => {
    const broken = '{\n  "a": 1,\n  "b": 2,\n}\n'
    const result = parseJsonWithPosition(broken)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.line).toBe(4)
    expect(result.message.length).toBeGreaterThan(0)
    expect(result.excerpt).toContain('^')
  })

  it('never throws, whatever the input', () => {
    expect(() => parseJsonWithPosition('')).not.toThrow()
    expect(() => parseJsonWithPosition('not json at all')).not.toThrow()
    expect(parseJsonWithPosition('').ok).toBe(false)
  })
})
