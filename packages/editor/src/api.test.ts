import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError, EVENTS_URL } from './api'

type Call = { url: string; init?: RequestInit }

function mockFetch(handler: (call: Call) => Response | Promise<Response>): Call[] {
  const calls: Call[] = []
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    return Promise.resolve(handler({ url, init }))
  })
  return calls
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('api reads', () => {
  it('gets endpoints from the mounted prefix', async () => {
    const calls = mockFetch(() => json([{ id: 'GET /users' }]))
    await expect(api.getEndpoints()).resolves.toEqual([{ id: 'GET /users' }])
    expect(calls[0]?.url).toBe('/__laqi/api/endpoints')
  })

  it('gets state, scenarios and status from their own paths', async () => {
    const calls = mockFetch(() => json({}))
    await api.getState()
    await api.getScenarios()
    await api.getStatus()
    expect(calls.map((c) => c.url)).toEqual([
      '/__laqi/api/state',
      '/__laqi/api/scenarios',
      '/__laqi/api/status',
    ])
  })
})

describe('api writes', () => {
  it('PUTs state as JSON with a content type', async () => {
    const calls = mockFetch(() => json({ scenario: null, overrides: {} }))
    await api.putState({ scenario: null, overrides: { 'GET /users': 'boom' } })

    const [call] = calls
    expect(call?.init?.method).toBe('PUT')
    expect(JSON.parse(String(call?.init?.body))).toEqual({
      scenario: null,
      overrides: { 'GET /users': 'boom' },
    })
    expect(new Headers(call?.init?.headers).get('Content-Type')).toBe('application/json')
  })

  it('URL-encodes the composite id so the slash does not become a path segment', async () => {
    const calls = mockFetch(() => json({ ok: true }))
    await api.updateEndpoint('GET /users/:id', { default: 'ok', responses: { ok: { status: 200 } } })
    expect(calls[0]?.url).toBe('/__laqi/api/endpoints/GET%20%2Fusers%2F%3Aid')
  })

  it('returns undefined for the 204 a delete answers with', async () => {
    mockFetch(() => new Response(null, { status: 204 }))
    await expect(api.deleteEndpoint('GET /users')).resolves.toBeUndefined()
  })

  it('POSTs a create with method and path alongside the definition', async () => {
    const calls = mockFetch(() => json({ id: 'POST /orders' }, 201))
    await api.createEndpoint({
      method: 'POST',
      path: '/orders',
      default: 'ok',
      responses: { ok: { status: 201 } },
    })
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      method: 'POST',
      path: '/orders',
      default: 'ok',
      responses: { ok: { status: 201 } },
    })
  })
})

describe('api errors', () => {
  it('throws the server message, not the status line', async () => {
    mockFetch(() => json({ error: 'laqi-control-plane', message: 'path must start with "/"' }, 400))
    await expect(api.getEndpoints()).rejects.toThrow('path must start with "/"')
  })

  it('carries the status code on the error', async () => {
    mockFetch(() => json({ message: 'nope' }, 409))
    await expect(api.getEndpoints()).rejects.toMatchObject({ status: 409 })
  })

  it('falls back to the status line when the body is not JSON', async () => {
    mockFetch(() => new Response('<html>502</html>', { status: 502, statusText: 'Bad Gateway' }))
    await expect(api.getEndpoints()).rejects.toThrow('502 Bad Gateway')
  })

  it('reports an unreachable server as status 0 rather than hanging', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')))
    await expect(api.getEndpoints()).rejects.toMatchObject({ status: 0 })
    await expect(api.getEndpoints()).rejects.toBeInstanceOf(ApiError)
  })
})

describe('EVENTS_URL', () => {
  it('points at the SSE route under the same prefix', () => {
    expect(EVENTS_URL).toBe('/__laqi/events')
  })
})
