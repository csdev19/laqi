import { describe, expect, it } from 'vitest'
import { STATUS_CODES, filterStatusCodes, parseStatusCode, statusClass } from './status-codes'

describe('STATUS_CODES', () => {
  it('is sorted by code and has no duplicates', () => {
    const codes = STATUS_CODES.map((entry) => entry.code)
    expect(codes).toEqual([...codes].sort((a, b) => a - b))
    expect(new Set(codes).size).toBe(codes.length)
  })

  it('names the codes the scaffold hands out, so the two surfaces agree', () => {
    // Every status suggestResponses can produce must be nameable in the
    // select. A scaffolded 422 that the dropdown cannot explain is a hole.
    for (const code of [200, 201, 204, 404, 409, 422, 500]) {
      expect(STATUS_CODES.find((entry) => entry.code === code)).toBeDefined()
    }
  })
})

describe('statusClass', () => {
  it('maps each range to the class the panel paints with', () => {
    expect(statusClass(100)).toBe('ok')
    expect(statusClass(200)).toBe('ok')
    expect(statusClass(301)).toBe('redirect')
    expect(statusClass(404)).toBe('client')
    expect(statusClass(500)).toBe('server')
  })
})

describe('filterStatusCodes', () => {
  it('returns everything for an empty query', () => {
    expect(filterStatusCodes('   ')).toHaveLength(STATUS_CODES.length)
  })

  it('finds a code by its digits', () => {
    expect(filterStatusCodes('404').map((entry) => entry.code)).toEqual([404])
  })

  it('finds a code by its name, case-insensitively', () => {
    expect(filterStatusCodes('not found').map((entry) => entry.code)).toEqual([404])
  })

  it('matches every typed token, in any order', () => {
    // "found not" and "not found" are the same intent; a user typing fast
    // gets the word order wrong and should still land on 404.
    expect(filterStatusCodes('found not').map((entry) => entry.code)).toEqual([404])
  })

  it('narrows progressively rather than jumping to one answer', () => {
    const partial = filterStatusCodes('not').map((entry) => entry.code)
    expect(partial).toContain(404)
    expect(partial).toContain(501)
    expect(partial.length).toBeGreaterThan(1)
  })

  it('returns nothing when a code is not in the catalogue', () => {
    // 599 is legal and enterable as free text, but it is not a named code.
    expect(filterStatusCodes('599')).toEqual([])
  })
})

describe('parseStatusCode', () => {
  // The field doubles as the catalogue's search box, so most of what passes
  // through here is a name being typed, not a broken code.
  it('reads a three-digit code in range', () => {
    expect(parseStatusCode('200')).toBe(200)
    expect(parseStatusCode(' 404 ')).toBe(404)
    expect(parseStatusCode('599')).toBe(599)
    expect(parseStatusCode('100')).toBe(100)
  })

  // `Number('201e44')` is 2.01e46. It used to reach a mock file and come
  // back as a Zod complaint about integers being ≤9007199254740991.
  it.each(['201e44', '0x1f4', '2e2', '+200', '200.0', '1_00'])(
    'refuses %s, which Number() would have accepted',
    (text) => {
      expect(parseStatusCode(text)).toBeNull()
    },
  )

  it('refuses codes outside the range HTTP defines', () => {
    expect(parseStatusCode('099')).toBeNull()
    expect(parseStatusCode('600')).toBeNull()
    expect(parseStatusCode('1000')).toBeNull()
  })

  it('refuses a name being typed, and an empty field', () => {
    expect(parseStatusCode('not found')).toBeNull()
    expect(parseStatusCode('')).toBeNull()
  })
})
