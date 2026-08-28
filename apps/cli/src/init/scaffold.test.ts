import { EndpointSchema, ScenariosSchema, parseEndpointKey } from '@laqi/schema'
import { describe, expect, it } from 'vitest'
import { emptyScaffold, exampleScaffold } from './scaffold'

describe('exampleScaffold', () => {
  const scaffold = exampleScaffold()

  it('has 4 routes and 11 responses, as the spec calls for', () => {
    const routes = Object.keys(scaffold.api)
    expect(routes).toHaveLength(4)

    const responseCount = Object.values(scaffold.api).reduce(
      (sum, endpoint) => sum + Object.keys(endpoint.responses).length,
      0,
    )
    expect(responseCount).toBe(11)
  })

  it('has a route with a success and an empty state', () => {
    const list = scaffold.api['GET /todos']
    expect(Object.keys(list?.responses ?? {})).toEqual(
      expect.arrayContaining(['ok', 'empty', 'error']),
    )
  })

  it('has a route with a slow response somewhere', () => {
    const slow = Object.values(scaffold.api).some((endpoint) =>
      Object.values(endpoint.responses).some((response) => (response.delay ?? 0) > 0),
    )
    expect(slow).toBe(true)
  })

  it('every key parses as a valid "METHOD /path", and every definition passes EndpointSchema', () => {
    for (const [key, definition] of Object.entries(scaffold.api)) {
      expect(parseEndpointKey(key).ok, key).toBe(true)
      expect(EndpointSchema.safeParse(definition).success, key).toBe(true)
    }
  })

  it("has exactly the three scenarios the spec's summary shows", () => {
    expect(Object.keys(scaffold.scenarios).sort()).toEqual(['empty-state', 'logged-out', 'offline'])
    expect(ScenariosSchema.safeParse(scaffold.scenarios).success).toBe(true)
  })

  it('every scenario override names a route and a response that actually exist', () => {
    for (const overrides of Object.values(scaffold.scenarios)) {
      for (const [route, response] of Object.entries(overrides)) {
        const endpoint = scaffold.api[route]
        expect(endpoint, route).toBeDefined()
        expect(Object.keys(endpoint?.responses ?? {})).toContain(response)
      }
    }
  })

  it('is deterministic — no randomness, no clock reads', () => {
    expect(exampleScaffold()).toEqual(exampleScaffold())
  })
})

describe('emptyScaffold', () => {
  const scaffold = emptyScaffold()

  it('is not a literal {} — it still has something to serve', () => {
    expect(Object.keys(scaffold.api).length).toBeGreaterThan(0)
  })

  it('has no scenarios', () => {
    expect(scaffold.scenarios).toEqual({})
  })

  it('passes schema validation, same as the example scaffold', () => {
    for (const [key, definition] of Object.entries(scaffold.api)) {
      expect(parseEndpointKey(key).ok, key).toBe(true)
      expect(EndpointSchema.safeParse(definition).success, key).toBe(true)
    }
    expect(ScenariosSchema.safeParse(scaffold.scenarios).success).toBe(true)
  })
})
