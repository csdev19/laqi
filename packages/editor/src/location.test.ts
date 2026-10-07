import { describe, expect, it } from 'vitest'
import { endpointFromSearch, searchForEndpoint } from './location'

describe('endpointFromSearch', () => {
  it('reads the endpoint id out of the query string', () => {
    expect(endpointFromSearch('?endpoint=POST%20/auth/login')).toBe('POST /auth/login')
  })

  it('accepts the plus and fully-encoded forms a hand-typed link may use', () => {
    expect(endpointFromSearch('?endpoint=POST+%2Fauth%2Flogin')).toBe('POST /auth/login')
  })

  it('is the list when the param is absent or empty', () => {
    expect(endpointFromSearch('')).toBeNull()
    expect(endpointFromSearch('?other=1')).toBeNull()
    expect(endpointFromSearch('?endpoint=')).toBeNull()
  })
})

describe('searchForEndpoint', () => {
  it('keeps the slashes of the path readable', () => {
    expect(searchForEndpoint('', 'POST /auth/login')).toBe('?endpoint=POST%20/auth/login')
  })

  it('round-trips a path with params and odd characters', () => {
    const id = 'GET /users/:id?x=1&y=2'
    expect(endpointFromSearch(searchForEndpoint('', id))).toBe(id)
  })

  it('drops the param for the list, and the whole query when nothing else is in it', () => {
    expect(searchForEndpoint('?endpoint=GET%20/users', null)).toBe('')
  })

  it('leaves unrelated params alone either way', () => {
    expect(searchForEndpoint('?debug=1', 'GET /users')).toBe('?debug=1&endpoint=GET%20/users')
    expect(searchForEndpoint('?debug=1&endpoint=GET%20/users', null)).toBe('?debug=1')
  })
})
