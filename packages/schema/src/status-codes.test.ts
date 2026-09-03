import { describe, expect, it } from 'vitest'
import { filterStatusCodes, STATUS_CODES, statusClass } from './status-codes'

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
