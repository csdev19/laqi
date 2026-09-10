import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { bodyHash, canonicalJson } from './canonical-json'

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex')

describe('canonicalJson', () => {
  it('sorts object keys, so two orderings of the same body hash the same', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}')
    expect(canonicalJson({ a: 2, b: 1 })).toBe('{"a":2,"b":1}')
  })

  it('sorts at every depth, including objects inside arrays', () => {
    expect(canonicalJson({ z: { y: 1, x: [{ b: 1, a: 2 }] } })).toBe(
      '{"z":{"x":[{"a":2,"b":1}],"y":1}}',
    )
  })

  it('keeps array order, which is data and not an ordering choice', () => {
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]')
  })

  it('sorts by UTF-16 code units, not by code point', () => {
    // The astral character is the surrogate pair D800 DC00, so its first code
    // unit sorts below FFFF even though its code point is far above it.
    const canonical = canonicalJson({ '￿': 1, '\u{10000}': 2 })
    expect(canonical?.indexOf('\u{10000}')).toBeLessThan(canonical?.indexOf('￿') ?? -1)
  })

  it('emits no whitespace', () => {
    expect(canonicalJson({ a: [1, 2], b: 'x' })).toBe('{"a":[1,2],"b":"x"}')
  })

  it('leaves scalars to JSON.stringify', () => {
    expect(canonicalJson(1.5)).toBe('1.5')
    expect(canonicalJson('a"b')).toBe('"a\\"b"')
    expect(canonicalJson(true)).toBe('true')
    expect(canonicalJson(null)).toBe('null')
  })

  it('drops undefined properties, exactly as writing the body would', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}')
  })

  it('honours toJSON, because the writer does too', () => {
    expect(canonicalJson({ at: new Date('2026-01-01T00:00:00.000Z') })).toBe(
      '{"at":"2026-01-01T00:00:00.000Z"}',
    )
  })

  it('has no string for an absent body', () => {
    expect(canonicalJson(undefined)).toBeUndefined()
  })
})

describe('bodyHash', () => {
  it('is the SHA-256 of the canonical form, in lowercase hex', () => {
    expect(bodyHash({ b: 1, a: 2 })).toBe(sha256('{"a":2,"b":1}'))
    expect(bodyHash({ b: 1, a: 2 })).toMatch(/^[0-9a-f]{64}$/)
  })

  it('ignores key order', () => {
    expect(bodyHash({ a: 2, b: 1 })).toBe(bodyHash({ b: 1, a: 2 }))
  })

  it('tells an absent body from a null one', () => {
    expect(bodyHash(undefined)).toBe(sha256(''))
    expect(bodyHash(null)).toBe(sha256('null'))
    expect(bodyHash(undefined)).not.toBe(bodyHash(null))
  })
})
