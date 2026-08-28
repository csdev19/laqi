import { buildRouteTable, type LoadedEndpoint } from '@laqi/core'
import type { LaqiState, Scenarios } from '@laqi/schema'
import { describe, expect, it, vi } from 'vitest'
import { createMockApp, type MockRuntime } from './mock-app'

const endpoints: LoadedEndpoint[] = [
  {
    id: 'GET /users',
    method: 'GET',
    path: '/users',
    default: 'ok',
    responses: {
      ok: { status: 200, body: { items: [{ id: 1 }] } },
      slow: { status: 200, delay: 60, body: { items: [] } },
      boom: { status: 500, body: { code: 'INTERNAL' } },
      custom: { status: 200, body: {}, headers: { 'x-custom': 'yes' } },
    },
    file: 'laqi/api.json',
    line: 2,
  },
  {
    id: 'DELETE /users/:id',
    method: 'DELETE',
    path: '/users/:id',
    default: 'gone',
    responses: { gone: { status: 204 } },
    file: 'laqi/api.json',
    line: 10,
  },
  {
    id: 'OPTIONS /widgets',
    method: 'OPTIONS',
    path: '/widgets',
    default: 'ok',
    responses: { ok: { status: 200, body: { allowed: ['GET'] } } },
    file: 'laqi/api.json',
    line: 20,
  },
]

function makeApp(
  state: LaqiState = { scenario: null, overrides: {} },
  scenarios: Scenarios = {},
  overrides: Partial<MockRuntime> = {},
) {
  const { table } = buildRouteTable(endpoints)
  const runtime: MockRuntime = { table, scenarios, getState: () => state, cors: '*', ...overrides }
  return createMockApp(runtime)
}

describe('createMockApp', () => {
  it('serves the default response', async () => {
    const res = await makeApp().request('/users')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ items: [{ id: 1 }] })
  })

  it('sets X-Laqi-Resolved on every response', async () => {
    const res = await makeApp().request('/users')
    expect(res.headers.get('X-Laqi-Resolved')).toBe('ok (default)')
  })

  it('serves the status declared on the response', async () => {
    const state: LaqiState = { scenario: null, overrides: { 'GET /users': 'boom' } }
    const res = await makeApp(state).request('/users')
    expect(res.status).toBe(500)
    expect(res.headers.get('X-Laqi-Resolved')).toBe('boom (state)')
  })

  it('serves a 204 with no body', async () => {
    const res = await makeApp().request('/users/42', { method: 'DELETE' })
    expect(res.status).toBe(204)
    expect(await res.text()).toBe('')
  })

  it('applies custom headers', async () => {
    const state: LaqiState = { scenario: null, overrides: { 'GET /users': 'custom' } }
    const res = await makeApp(state).request('/users')
    expect(res.headers.get('x-custom')).toBe('yes')
  })

  it('honours delay', async () => {
    const state: LaqiState = { scenario: null, overrides: { 'GET /users': 'slow' } }
    const started = Date.now()
    await makeApp(state).request('/users')
    expect(Date.now() - started).toBeGreaterThanOrEqual(50)
  })

  it('matches path params', async () => {
    const res = await makeApp().request('/users/42', { method: 'DELETE' })
    expect(res.status).toBe(204)
  })

  it('does not answer a method it was not declared for', async () => {
    const res = await makeApp().request('/users', { method: 'PATCH' })
    expect(res.status).toBe(404)
  })

  it('never mutates the loaded body between requests (v1 defect A)', async () => {
    const app = makeApp()
    const first = await (await app.request('/users?leak=SECRET')).json()
    const second = await (await app.request('/users')).json()

    expect(second).toEqual({ items: [{ id: 1 }] })
    expect(second).toEqual(first)
    expect(endpoints[0]?.responses.ok?.body).toEqual({ items: [{ id: 1 }] })
  })

  it('returns 500 with a clear message instead of hanging on a bad selector (v1 defect C)', async () => {
    const state: LaqiState = { scenario: null, overrides: { 'GET /users': 'ghost' } }
    const res = await makeApp(state).request('/users')
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).toContain('ghost')
    expect(res.headers.get('X-Laqi-Resolved')).toBe('ghost (state)')
  })

  it('reaches a declared OPTIONS mock instead of hono cors() swallowing it with a bare 204 (I5)', async () => {
    const res = await makeApp().request('/widgets', { method: 'OPTIONS' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ allowed: ['GET'] })
    expect(res.headers.get('X-Laqi-Resolved')).toBe('ok (default)')
  })

  it('never lets a mock-declared header override the real resolved header (I11)', async () => {
    const spoofed: LoadedEndpoint[] = [
      {
        id: 'GET /users',
        method: 'GET',
        path: '/users',
        default: 'ok',
        responses: { ok: { status: 200, body: {}, headers: { 'X-Laqi-Resolved': 'fake' } } },
        file: 'laqi/api.json',
        line: 2,
      },
    ]
    const { table } = buildRouteTable(spoofed)
    const runtime: MockRuntime = {
      table,
      scenarios: {},
      getState: () => ({ scenario: null, overrides: {} }),
      cors: '*',
    }
    const res = await createMockApp(runtime).request('/users')

    expect(res.headers.get('X-Laqi-Resolved')).toBe('ok (default)')
  })

  describe('onRequest', () => {
    it('fires with method, path, status, resolved layer/name and timing after a successful response', async () => {
      const onRequest = vi.fn()
      const app = makeApp(undefined, undefined, { onRequest })

      await app.request('/users')

      expect(onRequest).toHaveBeenCalledTimes(1)
      const event = onRequest.mock.calls[0]![0]
      expect(event).toMatchObject({
        type: 'request',
        method: 'GET',
        path: '/users',
        status: 200,
        resolvedName: 'ok',
        resolvedLayer: 'default',
        endpointId: 'GET /users',
      })
      expect(typeof event.ms).toBe('number')
      expect(event.ms).toBeGreaterThanOrEqual(0)
    })

    it('fires on a resolution failure too (500), not just on success', async () => {
      const onRequest = vi.fn()
      const state = { scenario: null, overrides: { 'GET /users': 'ghost' } }
      const app = makeApp(state, undefined, { onRequest })

      await app.request('/users')

      expect(onRequest).toHaveBeenCalledTimes(1)
      expect(onRequest.mock.calls[0]![0]).toMatchObject({ type: 'request', status: 500 })
    })

    it('reports the requested path, not the route pattern', async () => {
      // El log del panel muestra qué se pidió de verdad. Con el patrón,
      // cien requests a /users/1..100 se ven como cien filas idénticas.
      const onRequest = vi.fn()
      const app = makeApp(undefined, undefined, { onRequest })

      await app.request('/users/42', { method: 'DELETE' })

      expect(onRequest.mock.calls[0]![0]).toMatchObject({
        path: '/users/42',
        endpointId: 'DELETE /users/:id',
      })
    })

    it('fires for a request that matches no endpoint, with a null endpointId', async () => {
      // La fila no-route es la más importante del log ("¿por qué mi mock no
      // contesta?"). Sin este evento el panel no puede dibujarla nunca.
      const onRequest = vi.fn()
      const app = makeApp(undefined, undefined, { onRequest })

      await app.request('/typo')

      expect(onRequest).toHaveBeenCalledTimes(1)
      expect(onRequest.mock.calls[0]![0]).toMatchObject({
        type: 'request',
        method: 'GET',
        path: '/typo',
        status: 404,
        endpointId: null,
      })
    })

    it('leaves resolution fields absent on a no-route event — nothing resolved it', async () => {
      const onRequest = vi.fn()
      const app = makeApp(undefined, undefined, { onRequest })

      await app.request('/typo')

      const event = onRequest.mock.calls[0]![0]
      expect(event.resolvedName).toBeUndefined()
      expect(event.resolvedLayer).toBeUndefined()
    })

    it('does not fire a no-route event for a query string on a real route', async () => {
      const onRequest = vi.fn()
      const app = makeApp(undefined, undefined, { onRequest })

      await app.request('/users?page=2')

      expect(onRequest).toHaveBeenCalledTimes(1)
      expect(onRequest.mock.calls[0]![0]).toMatchObject({
        path: '/users',
        endpointId: 'GET /users',
      })
    })

    it('is optional — omitting it does not throw', async () => {
      const app = makeApp()
      const res = await app.request('/users')
      expect(res.status).toBe(200)
    })
  })
})
