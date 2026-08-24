import { buildRouteTable, type LoadedEndpoint } from '@laqi/core'
import type { LaqiState, Scenarios } from '@laqi/schema'
import { describe, expect, it } from 'vitest'
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
]

function makeApp(state: LaqiState = { scenario: null, overrides: {} }, scenarios: Scenarios = {}) {
  const { table } = buildRouteTable(endpoints)
  const runtime: MockRuntime = { table, scenarios, getState: () => state, cors: '*' }
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
})
