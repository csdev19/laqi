import { describe, expect, it } from 'vitest'
import type { LoadedEndpoint } from './loader'
import { buildRouteTable } from './route-table'

function endpoint(id: string, file: string, line = 1): LoadedEndpoint {
  const [method = 'GET', path = '/'] = id.split(' ')
  return {
    id,
    method: method as LoadedEndpoint['method'],
    path,
    default: 'ok',
    responses: { ok: { status: 200 } },
    file,
    line,
  }
}

describe('buildRouteTable', () => {
  it('indexes endpoints by id', () => {
    const { table, errors } = buildRouteTable([
      endpoint('GET /users', 'laqi/api.json'),
      endpoint('POST /users', 'laqi/api.json'),
    ])
    expect(errors).toEqual([])
    expect(table.byId.get('GET /users')?.path).toBe('/users')
    expect(table.endpoints).toHaveLength(2)
  })

  it('allows the same path under different methods', () => {
    const { errors } = buildRouteTable([
      endpoint('GET /users', 'laqi/api.json'),
      endpoint('DELETE /users', 'laqi/other.json'),
    ])
    expect(errors).toEqual([])
  })

  it('reports a duplicate route naming both files and lines', () => {
    const { errors } = buildRouteTable([
      endpoint('GET /users', 'laqi/api.json', 2),
      endpoint('GET /users', 'laqi/orders.json', 14),
    ])
    expect(errors).toHaveLength(1)
    const message = errors[0]?.message ?? ''
    expect(message).toContain('duplicate route')
    expect(message).toContain('GET /users')
    expect(message).toContain('laqi/api.json:2')
    expect(message).toContain('laqi/orders.json:14')
  })

  it('registers neither side of a collision, so the failure is impossible to miss', () => {
    const { table } = buildRouteTable([
      endpoint('GET /users', 'laqi/api.json', 2),
      endpoint('GET /users', 'laqi/orders.json', 14),
    ])
    expect(table.byId.has('GET /users')).toBe(false)
    expect(table.endpoints).toEqual([])
  })

  it('keeps unaffected endpoints when another pair collides', () => {
    const { table } = buildRouteTable([
      endpoint('GET /users', 'laqi/api.json'),
      endpoint('GET /users', 'laqi/orders.json'),
      endpoint('GET /health', 'laqi/api.json'),
    ])
    expect(table.endpoints.map((e) => e.id)).toEqual(['GET /health'])
  })

  it('reports a triple collision once, naming all three', () => {
    const { errors } = buildRouteTable([
      endpoint('GET /users', 'a.json', 1),
      endpoint('GET /users', 'b.json', 2),
      endpoint('GET /users', 'c.json', 3),
    ])
    expect(errors).toHaveLength(1)
    expect(errors[0]?.message).toContain('c.json:3')
  })
})
