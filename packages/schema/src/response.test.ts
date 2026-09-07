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

// A body cannot be turned back into the model that made it: JSON carries no
// literal unions, no absent optionals and no tuples. The source is kept so
// the panel can show what was pasted, and so regenerating reproduces the
// shape instead of guessing it from one sample.
describe('generatedFrom', () => {
  const model = 'export interface Todo { id: number }'

  it('accepts a response carrying the model it came from', () => {
    const result = ResponseSchema.safeParse({
      status: 200,
      body: { id: 1 },
      generatedFrom: { typeName: 'Todo', model },
    })

    expect(result.success).toBe(true)
    if (result.success) expect(result.data.generatedFrom?.typeName).toBe('Todo')
  })

  // Every response written before this existed, and every one written by
  // hand, has no model behind it.
  it('is optional', () => {
    expect(ResponseSchema.safeParse({ status: 200, body: {} }).success).toBe(true)
  })

  it('refuses a half-filled record, which would say a model exists when none does', () => {
    expect(
      ResponseSchema.safeParse({ status: 200, generatedFrom: { typeName: 'Todo' } }).success,
    ).toBe(false)
    expect(ResponseSchema.safeParse({ status: 200, generatedFrom: { model } }).success).toBe(false)
    expect(
      ResponseSchema.safeParse({ status: 200, generatedFrom: { typeName: '', model } }).success,
    ).toBe(false)
    expect(
      ResponseSchema.safeParse({ status: 200, generatedFrom: { typeName: 'Todo', model: '' } })
        .success,
    ).toBe(false)
  })
})
