import { describe, expect, it } from 'vitest'
import { responseRevision } from './revision'

describe('responseRevision', () => {
  it('is stable across key order, because the writer may reorder', () => {
    expect(responseRevision({ status: 200, body: { a: 1 } })).toBe(
      responseRevision({ body: { a: 1 }, status: 200 }),
    )
  })

  it('changes when the body changes', () => {
    expect(responseRevision({ status: 200, body: { a: 1 } })).not.toBe(
      responseRevision({ status: 200, body: { a: 2 } }),
    )
  })

  it('changes when a field other than the body changes', () => {
    expect(responseRevision({ status: 200, body: null })).not.toBe(
      responseRevision({ status: 201, body: null }),
    )
  })

  it('tells an absent body from a null one', () => {
    expect(responseRevision({ status: 204 })).not.toBe(
      responseRevision({ status: 204, body: null }),
    )
  })

  it('is a lowercase hex sha-256', () => {
    expect(responseRevision({ status: 200 })).toMatch(/^[0-9a-f]{64}$/)
  })
})
