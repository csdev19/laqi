import { describe, expect, it } from 'vitest'
import { EndpointSchema } from './endpoint'

const valid = {
  description: 'List all users',
  default: 'ok',
  responses: {
    ok: { status: 200, body: [] },
    boom: { status: 500, body: { code: 'INTERNAL' } },
  },
}

describe('EndpointSchema', () => {
  it('accepts a valid endpoint', () => {
    expect(EndpointSchema.parse(valid).default).toBe('ok')
  })

  it('rejects a default that names no declared response (v1 defect C)', () => {
    const result = EndpointSchema.safeParse({ ...valid, default: 'nope' })
    expect(result.success).toBe(false)
    if (result.success) return
    const issue = result.error.issues[0]
    expect(issue?.message).toContain('nope')
    expect(issue?.message).toContain('ok')
    expect(issue?.path).toEqual(['default'])
  })

  it('rejects an endpoint with no responses', () => {
    expect(EndpointSchema.safeParse({ default: 'ok', responses: {} }).success).toBe(false)
  })

  it('rejects a null entry (v1 defect B)', () => {
    expect(EndpointSchema.safeParse(null).success).toBe(false)
  })

  it('rejects a v1-shaped endpoint', () => {
    const v1 = {
      method: 'GET',
      codeResponse: '200',
      responses: [{ statusCode: '200', selectorCode: '200', body: {} }],
    }
    expect(EndpointSchema.safeParse(v1).success).toBe(false)
  })
})
