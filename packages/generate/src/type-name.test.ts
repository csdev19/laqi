import { describe, expect, it } from 'vitest'
import { typeNameFor } from './type-name'

describe('typeNameFor', () => {
  it('derives a PascalCase name from a path with a param', () => {
    expect(typeNameFor('GET /users/:id')).toBe('Users')
  })

  it('joins multi-segment paths into one PascalCase word', () => {
    expect(typeNameFor('GET /api/order-items')).toBe('ApiOrderItems')
  })

  it('falls back to "Response" for a root path', () => {
    expect(typeNameFor('GET /')).toBe('Response')
  })
})
