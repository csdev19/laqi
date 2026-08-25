import { describe, expect, it } from 'vitest'
import { filterEndpoints, paletteResults } from './search'
import type { Endpoint } from './types'

function endpoint(partial: Partial<Endpoint> & Pick<Endpoint, 'id' | 'method' | 'path'>): Endpoint {
  return {
    default: 'ok',
    responses: { ok: { status: 200 }, boom: { status: 500 } },
    file: 'laqi/api.json',
    line: 2,
    ...partial,
  }
}

const endpoints: Endpoint[] = [
  endpoint({ id: 'GET /users', method: 'GET', path: '/users', description: 'the people' }),
  endpoint({ id: 'POST /orders', method: 'POST', path: '/orders' }),
  endpoint({
    id: 'GET /cart',
    method: 'GET',
    path: '/cart',
    responses: { ok: { status: 200 }, empty: { status: 200 } },
    default: 'ok',
  }),
]

describe('filterEndpoints', () => {
  it('returns everything for an empty query', () => {
    expect(filterEndpoints(endpoints, '')).toHaveLength(3)
  })

  it('returns everything for a whitespace-only query', () => {
    expect(filterEndpoints(endpoints, '   ')).toHaveLength(3)
  })

  it('matches on path', () => {
    expect(filterEndpoints(endpoints, 'cart').map((e) => e.id)).toEqual(['GET /cart'])
  })

  it('matches on method, case-insensitively', () => {
    expect(filterEndpoints(endpoints, 'post').map((e) => e.id)).toEqual(['POST /orders'])
  })

  it('matches on description', () => {
    expect(filterEndpoints(endpoints, 'people').map((e) => e.id)).toEqual(['GET /users'])
  })

  it('matches on a response name', () => {
    expect(filterEndpoints(endpoints, 'empty').map((e) => e.id)).toEqual(['GET /cart'])
  })

  it('returns nothing when nothing matches', () => {
    expect(filterEndpoints(endpoints, 'zzz')).toEqual([])
  })
})

describe('paletteResults', () => {
  it('produces one row per endpoint-response pair', () => {
    expect(paletteResults(endpoints, '')).toHaveLength(6)
  })

  it('requires every token to match, in any order', () => {
    expect(paletteResults(endpoints, 'orders boom')).toEqual([
      { endpoint: endpoints[1], response: 'boom' },
    ])
    expect(paletteResults(endpoints, 'boom orders')).toEqual([
      { endpoint: endpoints[1], response: 'boom' },
    ])
  })

  it('matches a token against the method too', () => {
    expect(paletteResults(endpoints, 'post').map((r) => r.endpoint.id)).toEqual([
      'POST /orders',
      'POST /orders',
    ])
  })

  it('returns nothing when one token of several fails', () => {
    expect(paletteResults(endpoints, 'orders nosuchresponse')).toEqual([])
  })

  it('caps the result count', () => {
    expect(paletteResults(endpoints, '', 2)).toHaveLength(2)
  })
})
