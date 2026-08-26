import type { LaqiEvent, LoadedEndpoint } from '@laqi/core'
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
    updateEndpoint: () => ({ ok: true }),
    deleteEndpoint: () => ({ ok: true }),
    subscribe: () => () => {},
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

  it('rejects a path under the reserved /__laqi prefix with 400, before calling createEndpoint', async () => {
    const createEndpoint = vi.fn()
    const app = createControlPlaneApp(makeRuntime({ createEndpoint }))

    const res = await app.request('/api/endpoints', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        method: 'GET',
        path: '/__laqi/panel',
        default: 'ok',
        responses: { ok: { status: 200, body: {} } },
      }),
    })

    expect(res.status).toBe(400)
    expect(createEndpoint).not.toHaveBeenCalled()
  })
})

describe('cross-origin write protection', () => {
  it('rejects a POST with a foreign Origin header with 403, and never calls createEndpoint', async () => {
    const createEndpoint = vi.fn(() => ({ ok: true as const, id: 'GET /pwned' }))
    const app = createControlPlaneApp(makeRuntime({ createEndpoint }))

    const res = await app.request('/api/endpoints', {
      method: 'POST',
      headers: { 'content-type': 'text/plain;charset=UTF-8', Origin: 'https://evil.example' },
      body: JSON.stringify({ method: 'GET', path: '/pwned', default: 'ok', responses: { ok: { status: 200, body: {} } } }),
    })

    expect(res.status).toBe(403)
    expect(createEndpoint).not.toHaveBeenCalled()
  })

  it('allows a POST with a legitimate local Origin (http://localhost:3000)', async () => {
    const createEndpoint = vi.fn(() => ({ ok: true as const, id: 'GET /orders' }))
    const app = createControlPlaneApp(makeRuntime({ createEndpoint }))

    const res = await app.request('/api/endpoints', {
      method: 'POST',
      headers: { 'content-type': 'application/json', Origin: 'http://localhost:3000' },
      body: JSON.stringify({ method: 'GET', path: '/orders', default: 'ok', responses: { ok: { status: 200, body: {} } } }),
    })

    expect(res.status).toBe(201)
    expect(createEndpoint).toHaveBeenCalled()
  })

  it('allows a POST with no Origin header at all (curl, server-to-server)', async () => {
    const createEndpoint = vi.fn(() => ({ ok: true as const, id: 'GET /orders' }))
    const app = createControlPlaneApp(makeRuntime({ createEndpoint }))

    const res = await app.request('/api/endpoints', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: 'GET', path: '/orders', default: 'ok', responses: { ok: { status: 200, body: {} } } }),
    })

    expect(res.status).toBe(201)
    expect(createEndpoint).toHaveBeenCalled()
  })

  it('rejects a POST with Origin http://localhost.evil.example (startsWith bypass) with 403, and never calls createEndpoint', async () => {
    const createEndpoint = vi.fn(() => ({ ok: true as const, id: 'GET /pwned' }))
    const app = createControlPlaneApp(makeRuntime({ createEndpoint }))

    const res = await app.request('/api/endpoints', {
      method: 'POST',
      headers: { 'content-type': 'text/plain;charset=UTF-8', Origin: 'http://localhost.evil.example' },
      body: JSON.stringify({ method: 'GET', path: '/pwned', default: 'ok', responses: { ok: { status: 200, body: {} } } }),
    })

    expect(res.status).toBe(403)
    expect(createEndpoint).not.toHaveBeenCalled()
  })

  it('rejects a POST with Origin http://127.0.0.1.evil.example (startsWith bypass) with 403, and never calls createEndpoint', async () => {
    const createEndpoint = vi.fn(() => ({ ok: true as const, id: 'GET /pwned' }))
    const app = createControlPlaneApp(makeRuntime({ createEndpoint }))

    const res = await app.request('/api/endpoints', {
      method: 'POST',
      headers: { 'content-type': 'text/plain;charset=UTF-8', Origin: 'http://127.0.0.1.evil.example' },
      body: JSON.stringify({ method: 'GET', path: '/pwned', default: 'ok', responses: { ok: { status: 200, body: {} } } }),
    })

    expect(res.status).toBe(403)
    expect(createEndpoint).not.toHaveBeenCalled()
  })

  it('allows a POST with Origin http://[::1]:5173 (IPv6 loopback, e.g. Vite dev server)', async () => {
    const createEndpoint = vi.fn(() => ({ ok: true as const, id: 'GET /orders' }))
    const app = createControlPlaneApp(makeRuntime({ createEndpoint }))

    const res = await app.request('/api/endpoints', {
      method: 'POST',
      headers: { 'content-type': 'application/json', Origin: 'http://[::1]:5173' },
      body: JSON.stringify({ method: 'GET', path: '/orders', default: 'ok', responses: { ok: { status: 200, body: {} } } }),
    })

    expect(res.status).toBe(201)
    expect(createEndpoint).toHaveBeenCalled()
  })
})

describe('PUT /api/endpoints/:id', () => {
  it('updates the endpoint addressed by the URL-encoded id', async () => {
    const updateEndpoint = vi.fn(() => ({ ok: true as const }))
    const app = createControlPlaneApp(makeRuntime({ updateEndpoint }))

    const res = await app.request(`/api/endpoints/${encodeURIComponent('GET /users')}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ default: 'empty', responses: { empty: { status: 200, body: [] } } }),
    })

    expect(res.status).toBe(200)
    expect(updateEndpoint).toHaveBeenCalledWith('GET /users', {
      description: undefined,
      default: 'empty',
      responses: { empty: { status: 200, body: [] } },
    })
  })

  it('returns 404 when the runtime reports the id does not exist', async () => {
    const updateEndpoint = vi.fn(() => ({ ok: false as const, error: 'no endpoint "GET /ghost"' }))
    const app = createControlPlaneApp(makeRuntime({ updateEndpoint }))

    const res = await app.request(`/api/endpoints/${encodeURIComponent('GET /ghost')}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ default: 'ok', responses: { ok: { status: 200 } } }),
    })

    expect(res.status).toBe(404)
  })

  it('rejects an invalid definition with 400', async () => {
    const updateEndpoint = vi.fn()
    const app = createControlPlaneApp(makeRuntime({ updateEndpoint }))

    const res = await app.request(`/api/endpoints/${encodeURIComponent('GET /users')}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ default: 'ok', responses: {} }),
    })

    expect(res.status).toBe(400)
    expect(updateEndpoint).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/endpoints/:id', () => {
  it('deletes the endpoint and returns 204', async () => {
    const deleteEndpoint = vi.fn(() => ({ ok: true as const }))
    const app = createControlPlaneApp(makeRuntime({ deleteEndpoint }))

    const res = await app.request(`/api/endpoints/${encodeURIComponent('GET /users')}`, { method: 'DELETE' })

    expect(res.status).toBe(204)
    expect(deleteEndpoint).toHaveBeenCalledWith('GET /users')
  })

  it('returns 404 when the id does not exist', async () => {
    const deleteEndpoint = vi.fn(() => ({ ok: false as const, error: 'no endpoint "GET /ghost"' }))
    const app = createControlPlaneApp(makeRuntime({ deleteEndpoint }))

    const res = await app.request(`/api/endpoints/${encodeURIComponent('GET /ghost')}`, { method: 'DELETE' })
    expect(res.status).toBe(404)
  })
})

describe('GET /events (SSE)', () => {
  it('streams events emitted after the connection opens', async () => {
    let emit: ((event: LaqiEvent) => void) | undefined
    const app = createControlPlaneApp(
      makeRuntime({
        subscribe: (listener) => {
          emit = listener
          return () => {
            emit = undefined
          }
        },
      }),
    )

    const res = await app.request('/events')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/event-stream')

    const reader = res.body!.getReader()
    const decoder = new TextDecoder()

    // El handler recién queda "conectado" cuando terminó de registrar el
    // listener — darle una vuelta de microtask antes de emitir.
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(emit).toBeDefined()

    emit!({ type: 'endpoints-changed', endpointCount: 5 })

    const { value } = await reader.read()
    const text = decoder.decode(value)
    expect(text).toContain('event: endpoints-changed')
    expect(text).toContain(JSON.stringify({ type: 'endpoints-changed', endpointCount: 5 }))

    await reader.cancel()
  })

  it('unsubscribes when the client disconnects', async () => {
    let unsubscribed = false
    const app = createControlPlaneApp(
      makeRuntime({
        subscribe: () => () => {
          unsubscribed = true
        },
      }),
    )

    const res = await app.request('/events')
    const reader = res.body!.getReader()
    await new Promise((resolve) => setTimeout(resolve, 10))

    await reader.cancel()
    // 150ms: 5x el intervalo de poll de 30ms del handler SSE, margen de
    // sobra para no ser un test frágil por estar justo en el borde.
    await new Promise((resolve) => setTimeout(resolve, 150))

    expect(unsubscribed).toBe(true)
  })
})

describe('ids that contain a percent sign', () => {
  // Hono ya decodifica el param. Un decode extra tiraba URIError -> 500, y
  // el endpoint quedaba inaccesible desde el panel para siempre.
  it('does not 500 on a PUT whose id contains a literal %', async () => {
    const res = await createControlPlaneApp(makeRuntime()).request(`/api/endpoints/${encodeURIComponent('GET /100%')}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ default: 'ok', responses: { ok: { status: 200 } } }),
    })
    expect(res.status).not.toBe(500)
  })

  it('does not 500 on a DELETE whose id contains a literal %', async () => {
    const res = await createControlPlaneApp(makeRuntime()).request(`/api/endpoints/${encodeURIComponent('GET /100%')}`, {
      method: 'DELETE',
    })
    expect(res.status).not.toBe(500)
  })
})
