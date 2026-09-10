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
  it('converts OpenAPI braces to router colons', async () => {
    expect(toLaqiPath('/users/{id}')).toBe('/users/:id')
    expect(toLaqiPath('/a/{x}/b/{y}')).toBe('/a/:x/b/:y')
  })

  it('leaves a path with no params alone', async () => {
    expect(toLaqiPath('/users')).toBe('/users')
  })
})

describe('importOpenapi', () => {
  it('imports one endpoint per path and method', async () => {
    const { endpoints } = await importOpenapi(minimal)
    expect(endpoints.map((e) => `${e.method} ${e.path}`).sort()).toEqual([
      'DELETE /users/:id',
      'GET /users',
      'GET /users/:id',
    ])
  })

  it('names responses by status semantics, not by number', async () => {
    const { endpoints } = await importOpenapi(minimal)
    const users = endpoints.find((e) => e.path === '/users')!
    expect(Object.keys(users.definition.responses)).toEqual(['ok', 'error'])
  })

  it('picks the lowest 2xx as the default', async () => {
    const { endpoints } = await importOpenapi(minimal)
    expect(endpoints.find((e) => e.path === '/users')!.definition.default).toBe('ok')
    expect(endpoints.find((e) => e.method === 'DELETE')!.definition.default).toBe('no-content')
  })

  // The body is generated through the same compiler every other source
  // uses, so what is asserted is the SHAPE the schema describes, not the
  // particular values a seed produced.
  it('generates a body from the referenced schema, and records how', async () => {
    const { endpoints } = await importOpenapi(minimal)
    const one = endpoints.find((e) => e.path === '/users/:id' && e.method === 'GET')!
    const ok = one.definition.responses.ok!

    const body = ok.body as Record<string, unknown>
    expect(Object.keys(body).sort()).toEqual(['active', 'createdAt', 'email', 'id', 'name'])
    expect(typeof body['id']).toBe('number')
    expect(typeof body['name']).toBe('string')
    expect(typeof body['active']).toBe('boolean')
    // laqi produced these bytes, so it says so — and says what reproduces them.
    expect(ok.generation).toMatchObject({ seed: expect.any(Number) })
    expect(ok.schema).toMatchObject({ source: { kind: 'openapi' } })
  })

  it('generates an array body from an array schema', async () => {
    const { endpoints } = await importOpenapi(minimal)
    const list = endpoints.find((e) => e.path === '/users')!
    const body = list.definition.responses.ok!.body

    expect(Array.isArray(body)).toBe(true)
    expect((body as unknown[]).length).toBeGreaterThan(0)
    expect(typeof (body as Record<string, unknown>[])[0]!['name']).toBe('string')
  })

  // The pointer is what lets a refresh re-extract the same response instead
  // of guessing which one it was.
  it('records the pointer to the response it read', async () => {
    const { endpoints } = await importOpenapi(minimal)
    const list = endpoints.find((e) => e.path === '/users')!

    expect(list.definition.responses.ok!.schema!.source).toMatchObject({
      kind: 'openapi',
      pointer: '/paths/~1users/get/responses/200/content/application~1json/schema',
    })
  })

  it('uses the summary as the description', async () => {
    const { endpoints } = await importOpenapi(minimal)
    expect(endpoints.find((e) => e.path === '/users')!.definition.description).toBe('List users')
  })

  it('keeps a response with no content as a bare status', async () => {
    const { endpoints } = await importOpenapi(minimal)
    const error = endpoints.find((e) => e.path === '/users')!.definition.responses.error!
    expect(error.status).toBe(500)
    expect(error.body).toBeUndefined()
  })
})

describe('importOpenapi — examples beat schemas', () => {
  it('prefers an explicit example over a generated one', async () => {
    const { endpoints } = await importOpenapi({
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
    const ok = endpoints[0]!.definition.responses.ok!
    expect(ok.body).toEqual({ a: 'the real thing' })
    // The schema is still associated, so the response can be regenerated on
    // purpose later — but laqi did not produce these bytes and does not
    // claim it did, so there is no evidence beside them.
    expect(ok.schema).toMatchObject({ source: { kind: 'openapi' } })
    expect(ok.generation).toBeUndefined()
  })

  // Byte for value: the example is what the API's authors say the response
  // looks like. Normalising it would substitute laqi's judgement for theirs.
  it('keeps an example exactly as written, oddities included', async () => {
    const example = { id: 'inv_1', tags: [], meta: null, nested: { deep: [1, 2, 3] } }
    const { endpoints } = await importOpenapi({
      paths: {
        '/x': {
          get: {
            responses: {
              '200': { content: { 'application/json': { example } } },
            },
          },
        },
      },
    })

    expect(endpoints[0]!.definition.responses.ok!.body).toEqual(example)
  })

  it('falls back to the first named example', async () => {
    const { endpoints } = await importOpenapi({
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

  it('uses enum and default values from the schema', async () => {
    const { endpoints } = await importOpenapi({
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
    const body = endpoints[0]!.definition.responses.ok!.body as Record<string, unknown>
    // An enum is a closed set, so whatever comes out is one of its members.
    expect(['active', 'archived']).toContain(body['status'])
    expect(Number.isInteger(body['count'])).toBe(true)
  })
})

describe('importOpenapi — hostile input', () => {
  // Cutting a self-reference loses what the source said, so the strict
  // default refuses it and says which response and why. The endpoint is
  // still imported: a right status with no body beats a dropped route.
  it('refuses a circular $ref by default, naming the response it was in', async () => {
    const spec = {
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
    }

    const strict = await importOpenapi(spec)

    expect(strict.endpoints[0]!.definition.responses.ok!.body).toBeUndefined()
    expect(strict.skipped[0]?.where).toContain('GET /node')
    expect(strict.skipped[0]?.reason).toMatch(/lose information/i)

    // Acknowledged, it imports and the cycle is cut rather than followed.
    const permissive = await importOpenapi(spec, { allowLoss: true })
    const body = permissive.endpoints[0]!.definition.responses.ok!.body as Record<string, unknown>
    expect(typeof body['id']).toBe('number')
    expect(body['child']).toBeNull()
  })

  it('merges allOf branches into one object', async () => {
    const { endpoints } = await importOpenapi({
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
    const body = endpoints[0]!.definition.responses.ok!.body as Record<string, unknown>
    expect(typeof body['a']).toBe('string')
    expect(typeof body['b']).toBe('boolean')
  })

  it('skips the ranged and default status keys OpenAPI allows', async () => {
    const { endpoints } = await importOpenapi({
      paths: { '/x': { get: { responses: { '200': {}, '2XX': {}, default: {} } } } },
    })
    expect(Object.keys(endpoints[0]!.definition.responses)).toEqual(['ok'])
  })

  it('reports a path with no usable responses instead of importing a broken endpoint', async () => {
    const result = await importOpenapi({ paths: { '/x': { get: { responses: { default: {} } } } } })
    expect(result.endpoints).toEqual([])
    expect(result.skipped).toEqual([{ where: 'GET /x', reason: 'no usable responses declared' }])
  })

  it('imports the good paths and reports the bad ones, rather than rejecting the whole spec', async () => {
    const result = await importOpenapi({
      paths: {
        '/good': { get: { responses: { '200': {} } } },
        '/bad': 'not an object',
      },
    })
    expect(result.endpoints.map((e) => e.path)).toEqual(['/good'])
    expect(result.skipped[0]).toMatchObject({ where: '/bad' })
  })

  it('explains itself on something that is not an OpenAPI document', async () => {
    expect((await importOpenapi({ hello: 'world' })).skipped[0]!.reason).toContain('OpenAPI 3')
    expect((await importOpenapi('a string')).skipped[0]!.reason).toContain('not a JSON object')
  })

  it('falls back to status-N for a code with no readable name', async () => {
    const { endpoints } = await importOpenapi({
      paths: { '/x': { get: { responses: { '599': {}, '598': {} } } } },
    })
    // Ascending order: JS iterates an object's integer keys in sorted order.
    expect(Object.keys(endpoints[0]!.definition.responses)).toEqual(['status-598', 'status-599'])
  })

  it('deduplicates when two keys normalise to the same status', async () => {
    // OpenAPI says the key is a string; nothing stops '200' and '200.0',
    // and both are status 200, which would want to be called 'ok' twice.
    const { endpoints } = await importOpenapi({
      paths: { '/x': { get: { responses: { '200': {}, '200.0': {} } } } },
    })
    const names = Object.keys(endpoints[0]!.definition.responses)
    expect(names).toEqual(['ok', 'ok-2'])
    expect(new Set(names).size).toBe(names.length)
  })
})
