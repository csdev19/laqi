import { describe, expect, it } from 'vitest'
import { checkJson, tokenizeJson } from './highlight'

/** Reconstruir el source desde los tokens: la propiedad que no puede fallar. */
function roundTrip(source: string): string {
  return tokenizeJson(source)
    .map((t) => t.text)
    .join('')
}

describe('tokenizeJson', () => {
  it('marks a string followed by a colon as a key, and the value as a string', () => {
    const tokens = tokenizeJson('{"name":"Ada"}').filter((t) => t.kind !== 'plain')
    expect(tokens).toEqual([
      { kind: 'punct', text: '{' },
      { kind: 'key', text: '"name"' },
      { kind: 'punct', text: ':' },
      { kind: 'string', text: '"Ada"' },
      { kind: 'punct', text: '}' },
    ])
  })

  it('treats a string as a key even with whitespace before the colon', () => {
    const tokens = tokenizeJson('{"name" : 1}')
    expect(tokens.find((t) => t.text === '"name"')?.kind).toBe('key')
  })

  it('treats a bare array string as a value, not a key', () => {
    const tokens = tokenizeJson('["a"]')
    expect(tokens.find((t) => t.text === '"a"')?.kind).toBe('string')
  })

  it('recognises numbers, including negative and exponent forms', () => {
    for (const source of ['-1', '3.5', '2e10', '-2.5e-3']) {
      const tokens = tokenizeJson(source)
      expect(tokens).toEqual([{ kind: 'number', text: source }])
    }
  })

  it('recognises the three literals', () => {
    expect(tokenizeJson('true').map((t) => t.kind)).toEqual(['literal'])
    expect(tokenizeJson('false').map((t) => t.kind)).toEqual(['literal'])
    expect(tokenizeJson('null').map((t) => t.kind)).toEqual(['literal'])
  })

  it('does not mistake a longer word starting with a literal for a literal', () => {
    expect(tokenizeJson('nullable').every((t) => t.kind === 'plain')).toBe(true)
  })

  it('does not treat a colon inside a string as key evidence', () => {
    const tokens = tokenizeJson('["a:b"]')
    expect(tokens.find((t) => t.text === '"a:b"')?.kind).toBe('string')
  })

  it('handles an escaped quote inside a string', () => {
    const tokens = tokenizeJson('"say \\"hi\\""')
    expect(tokens).toEqual([{ kind: 'string', text: '"say \\"hi\\""' }])
  })

  it('round-trips every character, so nothing is ever dropped on screen', () => {
    const source = '{\n  "a": [1, true, null, "x"],\n  "b": {"c": -2.5}\n}'
    expect(roundTrip(source)).toBe(source)
  })

  it('round-trips and terminates on malformed input', () => {
    const source = '{"a": [1, }}} @@ "unclosed'
    expect(roundTrip(source)).toBe(source)
  })

  it('returns nothing for an empty source', () => {
    expect(tokenizeJson('')).toEqual([])
  })
})

describe('checkJson', () => {
  it('reports byte length for valid JSON', () => {
    expect(checkJson('{"a":1}')).toEqual({ valid: true, bytes: 7 })
  })

  it('counts bytes, not characters', () => {
    const result = checkJson('"é"')
    expect(result).toEqual({ valid: true, bytes: 4 })
  })

  it('reports a message for invalid JSON', () => {
    const result = checkJson('{"a":}')
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.message).toBeTruthy()
  })
})
