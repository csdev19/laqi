import { buildRouteTable, type LoadedEndpoint } from '@laqi/core'
import { describe, expect, it } from 'vitest'
import { createMockApp } from './mock-app'

const endpoints: LoadedEndpoint[] = [
  {
    id: 'GET /users',
    method: 'GET',
    path: '/users',
    default: 'ok',
    responses: { ok: { status: 200, body: [] }, boom: { status: 500, body: {} } },
    file: 'laqi/api.json',
    line: 2,
  },
]

const scenarios = { 'checkout-broken': { 'GET /users': 'boom' } }

function makeApp() {
  const { table } = buildRouteTable(endpoints)
  return createMockApp({
    table,
    scenarios,
    getState: () => ({ scenario: null, overrides: {} }),
    cors: '*',
  })
}

describe('X-Laqi-Response', () => {
  it('overrides for this request only', async () => {
    const app = makeApp()
    const overridden = await app.request('/users', { headers: { 'X-Laqi-Response': 'boom' } })
    expect(overridden.status).toBe(500)
    expect(overridden.headers.get('X-Laqi-Resolved')).toBe('boom (header)')

    const untouched = await app.request('/users')
    expect(untouched.status).toBe(200)
    expect(untouched.headers.get('X-Laqi-Resolved')).toBe('ok (default)')
  })
})

describe('X-Laqi-Scenario', () => {
  it('applies a scenario to one request and reports the header layer', async () => {
    const res = await makeApp().request('/users', {
      headers: { 'X-Laqi-Scenario': 'checkout-broken' },
    })
    expect(res.status).toBe(500)
    expect(res.headers.get('X-Laqi-Resolved')).toBe('boom (header)')
  })
})

describe('no matching route', () => {
  it('returns 404 naming the method and path', async () => {
    const res = await makeApp().request('/typo')
    expect(res.status).toBe(404)

    const body = (await res.json()) as { error: string; message: string; method: string; path: string }
    expect(body.error).toBe('laqi')
    expect(body.message).toContain('no matching route')
    expect(body.method).toBe('GET')
    expect(body.path).toBe('/typo')
  })

  it('lists what is available, so the typo is obvious', async () => {
    const body = (await (await makeApp().request('/usres')).json()) as { available: string[] }
    expect(body.available).toContain('GET /users')
  })

  it('caps the available list so a hundred endpoints do not flood the response', async () => {
    const many: LoadedEndpoint[] = Array.from({ length: 60 }, (_, i) => ({
      id: `GET /r${i}`,
      method: 'GET' as const,
      path: `/r${i}`,
      default: 'ok',
      responses: { ok: { status: 200, body: {} } },
      file: 'laqi/api.json',
      line: i + 1,
    }))
    const { table } = buildRouteTable(many)
    const app = createMockApp({
      table,
      scenarios: {},
      getState: () => ({ scenario: null, overrides: {} }),
      cors: '*',
    })

    const body = (await (await app.request('/nope')).json()) as { available: string[] }
    expect(body.available.length).toBeLessThanOrEqual(20)
  })

  it('answers a no-route request for any method', async () => {
    expect((await makeApp().request('/typo', { method: 'POST' })).status).toBe(404)
  })
})
