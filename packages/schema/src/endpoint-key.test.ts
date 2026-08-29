import { describe, expect, it } from 'vitest'
import { formatEndpointId, parseEndpointKey, RESERVED_PREFIX } from './endpoint-key'

function ok(key: string) {
  const result = parseEndpointKey(key)
  if (!result.ok) throw new Error(`expected ok, got error: ${result.error}`)
  return result.value
}

function err(key: string) {
  const result = parseEndpointKey(key)
  if (result.ok) throw new Error(`expected error, got ok`)
  return result.error
}

describe('parseEndpointKey', () => {
  it('parses "GET /users"', () => {
    expect(ok('GET /users')).toEqual({ method: 'GET', path: '/users' })
  })

  it('parses a path with params', () => {
    expect(ok('DELETE /users/:id/orders/:orderId')).toEqual({
      method: 'DELETE',
      path: '/users/:id/orders/:orderId',
    })
  })

  it('normalises the method to uppercase', () => {
    expect(ok('post /users').method).toBe('POST')
  })

  it('tolerates extra whitespace', () => {
    expect(ok('  GET   /users  ')).toEqual({ method: 'GET', path: '/users' })
  })

  it('allows the same path under different methods', () => {
    expect(ok('GET /users').path).toBe(ok('POST /users').path)
  })

  it('rejects a key with no method', () => {
    expect(err('/users')).toContain('METHOD /path')
  })

  it('rejects an unknown method', () => {
    expect(err('FETCH /users')).toContain('FETCH')
  })

  it('rejects a path that does not start with a slash', () => {
    expect(err('GET users')).toContain('must start with')
  })

  it('rejects the v1 method-prefix hack', () => {
    expect(err('(get)files/:id')).toContain('METHOD /path')
  })

  it('rejects the reserved control-panel prefix', () => {
    expect(err('GET /__laqi')).toContain(RESERVED_PREFIX)
    expect(err('GET /__laqi/api/state')).toContain(RESERVED_PREFIX)
  })

  it('does not reject a path that merely starts with the same letters', () => {
    expect(ok('GET /__laqidose').path).toBe('/__laqidose')
  })
})

describe('formatEndpointId', () => {
  it('round-trips with parseEndpointKey', () => {
    const id = formatEndpointId('GET', '/users/:id')
    expect(id).toBe('GET /users/:id')
    expect(ok(id)).toEqual({ method: 'GET', path: '/users/:id' })
  })
})

describe('unreachable paths', () => {
  // Both a client and a server normalize the URL before routing, so a route
  // declared with `..` can never be reached. Rejecting it turns that into
  // an explicit error instead of a dead endpoint.
  it('rejects a path with a .. segment', () => {
    for (const key of ['GET /../escaped', 'GET /a/../b', 'GET /..', 'POST /a/b/../../c']) {
      const result = parseEndpointKey(key)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toContain('..')
    }
  })

  it('allows a dot that is not a traversal segment', () => {
    for (const key of ['GET /files/report.pdf', 'GET /v1.2/users', 'GET /a..b']) {
      expect(parseEndpointKey(key).ok).toBe(true)
    }
  })
})
