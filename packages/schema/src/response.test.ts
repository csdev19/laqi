import { describe, expect, it } from 'vitest'
import { ResponseSchema } from './response'

describe('ResponseSchema', () => {
  it('accepts a minimal response', () => {
    const parsed = ResponseSchema.parse({ status: 200, body: { message: 'OK' } })
    expect(parsed.status).toBe(200)
  })

  it('accepts a response with no body (204)', () => {
    expect(ResponseSchema.parse({ status: 204 }).status).toBe(204)
  })

  it('accepts delay and headers', () => {
    const parsed = ResponseSchema.parse({
      status: 200,
      body: [],
      delay: 3000,
      headers: { 'x-custom': 'yes' },
    })
    expect(parsed.delay).toBe(3000)
    expect(parsed.headers).toEqual({ 'x-custom': 'yes' })
  })

  it('rejects a status outside 100-599', () => {
    expect(ResponseSchema.safeParse({ status: 99 }).success).toBe(false)
    expect(ResponseSchema.safeParse({ status: 600 }).success).toBe(false)
  })

  it('rejects a status given as a string (v1 defect I)', () => {
    expect(ResponseSchema.safeParse({ status: '200' }).success).toBe(false)
  })

  it('rejects a negative delay', () => {
    expect(ResponseSchema.safeParse({ status: 200, delay: -1 }).success).toBe(false)
  })
})
