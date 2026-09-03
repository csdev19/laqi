import { describe, expect, it } from 'vitest'
import { hasPathParam, suggestResponses } from './scaffold'

const names = (input: Parameters<typeof suggestResponses>[0]) =>
  suggestResponses(input).map((suggestion) => suggestion.name)

describe('hasPathParam', () => {
  it('sees a colon segment', () => {
    expect(hasPathParam('/orders/:id')).toBe(true)
    expect(hasPathParam('/orders/:id/items')).toBe(true)
  })

  it('does not mistake a colon inside a literal segment for a param', () => {
    // A route pattern's param is a whole segment. `/a:b` is a literal path.
    expect(hasPathParam('/orders/a:b')).toBe(false)
    expect(hasPathParam('/orders')).toBe(false)
  })
})

describe('suggestResponses', () => {
  it('gives a collection GET an empty case, not a not-found', () => {
    expect(names({ method: 'GET', path: '/orders' })).toEqual(['ok', 'empty', 'error'])
  })

  it('gives an item GET a not-found, not an empty', () => {
    expect(names({ method: 'GET', path: '/orders/:id' })).toEqual(['ok', 'not-found', 'error'])
  })

  it('gives POST the create family regardless of path shape', () => {
    expect(names({ method: 'POST', path: '/orders' })).toEqual([
      'created',
      'validation-error',
      'conflict',
    ])
  })

  it('gives an item PUT a not-found and a conflict', () => {
    expect(names({ method: 'PUT', path: '/orders/:id' })).toEqual(['ok', 'not-found', 'conflict'])
  })

  it('gives PATCH the same family as PUT', () => {
    expect(names({ method: 'PATCH', path: '/orders/:id' })).toEqual(
      names({ method: 'PUT', path: '/orders/:id' }),
    )
  })

  it('gives DELETE a 204 with no body key at all', () => {
    const suggestions = suggestResponses({ method: 'DELETE', path: '/orders/:id' })
    const deleted = suggestions.find((suggestion) => suggestion.name === 'deleted')
    expect(deleted?.response.status).toBe(204)
    // Not `body: undefined` — the key must be absent, or the writer emits
    // `"body": null` into the mock file and the server sends a body on a 204.
    expect(Object.hasOwn(deleted!.response, 'body')).toBe(false)
  })

  it('gives a collection GET an empty ARRAY, not an empty object', () => {
    const empty = suggestResponses({ method: 'GET', path: '/orders' }).find(
      (suggestion) => suggestion.name === 'empty',
    )
    expect(empty?.response.body).toEqual([])
  })

  it('writes failure bodies in the shape the example project already uses', () => {
    const notFound = suggestResponses({ method: 'GET', path: '/orders/:id' }).find(
      (suggestion) => suggestion.name === 'not-found',
    )
    expect(notFound?.response).toMatchObject({ status: 404, body: { message: expect.any(String) } })
  })

  it('never suggests a name the endpoint already has', () => {
    // The scaffold adds; it does not replace. Overwriting a body someone
    // wrote by hand is data loss, and it is silent.
    expect(names({ method: 'GET', path: '/orders/:id', existing: ['ok', 'error'] })).toEqual([
      'not-found',
    ])
  })

  it('returns nothing when the family is fully present', () => {
    expect(names({ method: 'DELETE', path: '/orders', existing: ['deleted'] })).toEqual([])
  })

  it('returns nothing for a method it has no opinion about', () => {
    expect(names({ method: 'TRACE', path: '/orders' })).toEqual([])
  })

  it('is case-insensitive about the method', () => {
    expect(names({ method: 'get', path: '/orders' })).toEqual(
      names({ method: 'GET', path: '/orders' }),
    )
  })

  it('produces responses that satisfy the response schema', async () => {
    const { ResponseSchema } = await import('./response')
    for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']) {
      for (const path of ['/orders', '/orders/:id']) {
        for (const suggestion of suggestResponses({ method, path })) {
          expect(ResponseSchema.safeParse(suggestion.response).success).toBe(true)
        }
      }
    }
  })
})
