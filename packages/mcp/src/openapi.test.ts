import { describe, expect, it } from 'vitest'
import { importOpenapi, toLaqiPath } from './openapi'

const minimal = {
  openapi: '3.0.0',
  paths: {
    '/users': {
      get: {
        summary: 'List users',
        responses: {
          '200': {
            description: 'the users',
            content: {
              'application/json': {
                schema: { type: 'array', items: { $ref: '#/components/schemas/User' } },
              },
            },
          },
          '500': { description: 'boom' },
        },
      },
    },
    '/users/{id}': {
      get: {
        responses: {
          '200': {
            description: 'one user',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } },
          },
          '404': { description: 'gone' },
        },
      },
      delete: { responses: { '204': { description: 'deleted' } } },
    },
  },
  components: {
    schemas: {
      User: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          name: { type: 'string' },
          email: { type: 'string', format: 'email' },
          active: { type: 'boolean' },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
    },
  },
}

describe('toLaqiPath', () => {
  it('converts OpenAPI braces to router colons', () => {
    expect(toLaqiPath('/users/{id}')).toBe('/users/:id')
    expect(toLaqiPath('/a/{x}/b/{y}')).toBe('/a/:x/b/:y')
  })

  it('leaves a path with no params alone', () => {
    expect(toLaqiPath('/users')).toBe('/users')
  })
})

describe('importOpenapi', () => {
  it('imports one endpoint per path and method', () => {
    const { endpoints } = importOpenapi(minimal)
    expect(endpoints.map((e) => `${e.method} ${e.path}`).sort()).toEqual([
      'DELETE /users/:id',
      'GET /users',
      'GET /users/:id',
    ])
  })

  it('names responses by status semantics, not by number', () => {
    const { endpoints } = importOpenapi(minimal)
    const users = endpoints.find((e) => e.path === '/users')!
    expect(Object.keys(users.definition.responses)).toEqual(['ok', 'error'])
  })

  it('picks the lowest 2xx as the default', () => {
    const { endpoints } = importOpenapi(minimal)
    expect(endpoints.find((e) => e.path === '/users')!.definition.default).toBe('ok')
    expect(endpoints.find((e) => e.method === 'DELETE')!.definition.default).toBe('no-content')
  })

  it('generates a body from the referenced schema', () => {
    const { endpoints } = importOpenapi(minimal)
    const one = endpoints.find((e) => e.path === '/users/:id' && e.method === 'GET')!
    expect(one.definition.responses.ok!.body).toEqual({
      id: 0,
      name: 'string',
      email: 'ada@example.com',
      active: true,
      createdAt: '2026-01-01T00:00:00Z',
    })
  })

  it('wraps an array schema around one generated item', () => {
    const { endpoints } = importOpenapi(minimal)
    const list = endpoints.find((e) => e.path === '/users')!
    expect(Array.isArray(list.definition.responses.ok!.body)).toBe(true)
    expect((list.definition.responses.ok!.body as unknown[])[0]).toMatchObject({ name: 'string' })
  })

  it('uses the summary as the description', () => {
    const { endpoints } = importOpenapi(minimal)
    expect(endpoints.find((e) => e.path === '/users')!.definition.description).toBe('List users')
  })

  it('keeps a response with no content as a bare status', () => {
    const { endpoints } = importOpenapi(minimal)
    const error = endpoints.find((e) => e.path === '/users')!.definition.responses.error!
    expect(error.status).toBe(500)
    expect(error.body).toBeUndefined()
  })
})

describe('importOpenapi — examples beat schemas', () => {
  it('prefers an explicit example over a generated one', () => {
    const { endpoints } = importOpenapi({
      paths: {
        '/x': {
          get: {
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: { type: 'object', properties: { a: { type: 'string' } } },
                    example: { a: 'the real thing' },
                  },
                },
              },
            },
          },
        },
      },
    })
    expect(endpoints[0]!.definition.responses.ok!.body).toEqual({ a: 'the real thing' })
  })

  it('falls back to the first named example', () => {
    const { endpoints } = importOpenapi({
      paths: {
        '/x': {
          get: {
            responses: {
              '200': {
                content: {
                  'application/json': { examples: { happy: { value: { a: 1 } } } },
                },
              },
            },
          },
        },
      },
    })
    expect(endpoints[0]!.definition.responses.ok!.body).toEqual({ a: 1 })
  })

  it('uses enum and default values from the schema', () => {
    const { endpoints } = importOpenapi({
      paths: {
        '/x': {
          get: {
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        status: { type: 'string', enum: ['active', 'archived'] },
                        count: { type: 'integer', default: 42 },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    })
    expect(endpoints[0]!.definition.responses.ok!.body).toEqual({ status: 'active', count: 42 })
  })
})

describe('importOpenapi — hostile input', () => {
  it('survives a circular $ref instead of hanging', () => {
    const { endpoints } = importOpenapi({
      paths: {
        '/node': {
          get: {
            responses: {
              '200': {
                content: { 'application/json': { schema: { $ref: '#/components/schemas/Node' } } },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          Node: {
            type: 'object',
            properties: { id: { type: 'integer' }, child: { $ref: '#/components/schemas/Node' } },
          },
        },
      },
    })
    expect(endpoints[0]!.definition.responses.ok!.body).toEqual({ id: 0, child: null })
  })

  it('merges allOf branches into one object', () => {
    const { endpoints } = importOpenapi({
      paths: {
        '/x': {
          get: {
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: {
                      allOf: [
                        { type: 'object', properties: { a: { type: 'string' } } },
                        { type: 'object', properties: { b: { type: 'boolean' } } },
                      ],
                    },
                  },
                },
              },
            },
          },
        },
      },
    })
    expect(endpoints[0]!.definition.responses.ok!.body).toEqual({ a: 'string', b: true })
  })

  it('skips the ranged and default status keys OpenAPI allows', () => {
    const { endpoints } = importOpenapi({
      paths: { '/x': { get: { responses: { '200': {}, '2XX': {}, default: {} } } } },
    })
    expect(Object.keys(endpoints[0]!.definition.responses)).toEqual(['ok'])
  })

  it('reports a path with no usable responses instead of importing a broken endpoint', () => {
    const result = importOpenapi({ paths: { '/x': { get: { responses: { default: {} } } } } })
    expect(result.endpoints).toEqual([])
    expect(result.skipped).toEqual([{ where: 'GET /x', reason: 'no usable responses declared' }])
  })

  it('imports the good paths and reports the bad ones, rather than rejecting the whole spec', () => {
    const result = importOpenapi({
      paths: {
        '/good': { get: { responses: { '200': {} } } },
        '/bad': 'not an object',
      },
    })
    expect(result.endpoints.map((e) => e.path)).toEqual(['/good'])
    expect(result.skipped[0]).toMatchObject({ where: '/bad' })
  })

  it('explains itself on something that is not an OpenAPI document', () => {
    expect(importOpenapi({ hello: 'world' }).skipped[0]!.reason).toContain('OpenAPI 3')
    expect(importOpenapi('a string').skipped[0]!.reason).toContain('not a JSON object')
  })

  it('falls back to status-N for a code with no readable name', () => {
    const { endpoints } = importOpenapi({
      paths: { '/x': { get: { responses: { '599': {}, '598': {} } } } },
    })
    // Ascending order: JS iterates an object's integer keys in sorted order.
    expect(Object.keys(endpoints[0]!.definition.responses)).toEqual(['status-598', 'status-599'])
  })

  it('deduplicates when two keys normalise to the same status', () => {
    // OpenAPI says the key is a string; nothing stops '200' and '200.0',
    // and both are status 200, which would want to be called 'ok' twice.
    const { endpoints } = importOpenapi({
      paths: { '/x': { get: { responses: { '200': {}, '200.0': {} } } } },
    })
    const names = Object.keys(endpoints[0]!.definition.responses)
    expect(names).toEqual(['ok', 'ok-2'])
    expect(new Set(names).size).toBe(names.length)
  })
})
