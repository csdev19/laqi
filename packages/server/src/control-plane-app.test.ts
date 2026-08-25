import type { LoadedEndpoint } from '@laqi/core'
import type { LaqiState } from '@laqi/schema'
import { describe, expect, it, vi } from 'vitest'
import { createControlPlaneApp, type ControlPlaneRuntime } from './control-plane-app'

const usersEndpoint: LoadedEndpoint = {
  id: 'GET /users',
  method: 'GET',
  path: '/users',
  default: 'ok',
  responses: { ok: { status: 200, body: [] }, boom: { status: 500, body: {} } },
  file: 'laqi/api.json',
  line: 2,
}

function makeRuntime(overrides: Partial<ControlPlaneRuntime> = {}): ControlPlaneRuntime {
  let state: LaqiState = { scenario: null, overrides: {} }
  return {
    getEndpoints: () => [usersEndpoint],
    getState: () => state,
    setState: (next) => {
      state = next
    },
    getScenarios: () => ({}),
    getStatus: () => ({ watching: 'laqi/', endpointCount: 1, address: '127.0.0.1:8000', errors: [] }),
    createEndpoint: () => ({ ok: true, id: 'GET /new' }),
    ...overrides,
  }
}

describe('GET /api/endpoints', () => {
  it('lists the loaded endpoints', async () => {
    const app = createControlPlaneApp(makeRuntime())
    const res = await app.request('/api/endpoints')
    expect(res.status).toBe(200)
    const body = (await res.json()) as LoadedEndpoint[]
    expect(body).toEqual([usersEndpoint])
  })
})

describe('GET /api/state', () => {
  it('returns the current state', async () => {
    const app = createControlPlaneApp(makeRuntime({ getState: () => ({ scenario: 'checkout-broken', overrides: { 'GET /users': 'boom' } }) }))
    const res = await app.request('/api/state')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ scenario: 'checkout-broken', overrides: { 'GET /users': 'boom' } })
  })
})

describe('PUT /api/state', () => {
  it('persists a valid state and echoes it back', async () => {
    const setState = vi.fn()
    const app = createControlPlaneApp(makeRuntime({ setState }))

    const res = await app.request('/api/state', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scenario: null, overrides: { 'GET /users': 'boom' } }),
    })

    expect(res.status).toBe(200)
    expect(setState).toHaveBeenCalledWith({ scenario: null, overrides: { 'GET /users': 'boom' } })
    expect(await res.json()).toEqual({ scenario: null, overrides: { 'GET /users': 'boom' } })
  })

  it('fills in defaults for a partial body', async () => {
    const setState = vi.fn()
    const app = createControlPlaneApp(makeRuntime({ setState }))

    const res = await app.request('/api/state', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })

    expect(res.status).toBe(200)
    expect(setState).toHaveBeenCalledWith({ scenario: null, overrides: {} })
  })

  it('rejects a malformed body with 400 and does not call setState', async () => {
    const setState = vi.fn()
    const app = createControlPlaneApp(makeRuntime({ setState }))

    const res = await app.request('/api/state', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ overrides: 42 }),
    })

    expect(res.status).toBe(400)
    expect(setState).not.toHaveBeenCalled()
  })

  it('rejects a body that is not valid JSON at all', async () => {
    const app = createControlPlaneApp(makeRuntime())
    const res = await app.request('/api/state', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    })
    expect(res.status).toBe(400)
  })
})

describe('unmatched /__laqi paths', () => {
  it('returns a control-plane-flavoured 404, not a bare Hono 404', async () => {
    const app = createControlPlaneApp(makeRuntime())
    const res = await app.request('/api/nope')
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('laqi-control-plane')
  })
})

describe('GET /api/scenarios', () => {
  it('returns the loaded scenarios', async () => {
    const app = createControlPlaneApp(
      makeRuntime({ getScenarios: () => ({ 'checkout-broken': { 'GET /users': 'boom' } }) }),
    )
    const res = await app.request('/api/scenarios')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ 'checkout-broken': { 'GET /users': 'boom' } })
  })
})

describe('GET /api/status', () => {
  it('returns what the CLI is watching, and load errors', async () => {
    const app = createControlPlaneApp(
      makeRuntime({
        getStatus: () => ({
          watching: 'laqi/',
          endpointCount: 27,
          address: '127.0.0.1:8000',
          errors: [{ file: 'laqi/orders.json', line: 14, col: 7, message: 'trailing comma', excerpt: '...' }],
        }),
      }),
    )
    const res = await app.request('/api/status')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      watching: 'laqi/',
      endpointCount: 27,
      address: '127.0.0.1:8000',
      errors: [{ file: 'laqi/orders.json', line: 14, col: 7, message: 'trailing comma', excerpt: '...' }],
    })
  })
})

describe('POST /api/endpoints', () => {
  it('creates the endpoint and returns 201 with its id', async () => {
    const createEndpoint = vi.fn(() => ({ ok: true as const, id: 'POST /orders' }))
    const app = createControlPlaneApp(makeRuntime({ createEndpoint }))

    const res = await app.request('/api/endpoints', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        method: 'POST',
        path: '/orders',
        default: 'created',
        responses: { created: { status: 201, body: {} } },
      }),
    })

    expect(res.status).toBe(201)
    expect(createEndpoint).toHaveBeenCalledWith({
      method: 'POST',
      path: '/orders',
      description: undefined,
      default: 'created',
      responses: { created: { status: 201, body: {} } },
    })
    expect(await res.json()).toEqual({ id: 'POST /orders' })
  })

  it('rejects an unknown HTTP method', async () => {
    const createEndpoint = vi.fn()
    const app = createControlPlaneApp(makeRuntime({ createEndpoint }))

    const res = await app.request('/api/endpoints', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: 'FETCH', path: '/orders', default: 'ok', responses: { ok: { status: 200 } } }),
    })

    expect(res.status).toBe(400)
    expect(createEndpoint).not.toHaveBeenCalled()
  })

  it('rejects a path that does not start with "/"', async () => {
    const createEndpoint = vi.fn()
    const app = createControlPlaneApp(makeRuntime({ createEndpoint }))

    const res = await app.request('/api/endpoints', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: 'GET', path: 'orders', default: 'ok', responses: { ok: { status: 200 } } }),
    })

    expect(res.status).toBe(400)
    expect(createEndpoint).not.toHaveBeenCalled()
  })

  it('rejects an invalid endpoint definition (no responses)', async () => {
    const createEndpoint = vi.fn()
    const app = createControlPlaneApp(makeRuntime({ createEndpoint }))

    const res = await app.request('/api/endpoints', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: 'GET', path: '/orders', default: 'ok', responses: {} }),
    })

    expect(res.status).toBe(400)
    expect(createEndpoint).not.toHaveBeenCalled()
  })

  it('propagates a failure from the runtime (e.g. duplicate id) as a client error', async () => {
    const createEndpoint = vi.fn(() => ({ ok: false as const, error: '"GET /orders" already exists' }))
    const app = createControlPlaneApp(makeRuntime({ createEndpoint }))

    const res = await app.request('/api/endpoints', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: 'GET', path: '/orders', default: 'ok', responses: { ok: { status: 200 } } }),
    })

    expect(res.status).toBe(409)
    const body = (await res.json()) as { message: string }
    expect(body.message).toContain('already exists')
  })
})
