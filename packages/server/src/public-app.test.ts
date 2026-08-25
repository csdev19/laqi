import { buildRouteTable, type LoadedEndpoint } from '@laqi/core'
import { describe, expect, it } from 'vitest'
import { createControlPlaneApp } from './control-plane-app'
import { createPublicApp, generateToken, MAX_BUCKETS, type PublicRuntime } from './public-app'

const endpoints: LoadedEndpoint[] = [
  {
    id: 'GET /users',
    method: 'GET',
    path: '/users',
    default: 'ok',
    responses: { ok: { status: 200, body: { items: [] } } },
    file: 'laqi/api.json',
    line: 2,
  },
]

const TOKEN = 'aaaabbbbccccddddeeeeffff00001111'

function makeMock() {
  const { table } = buildRouteTable(endpoints)
  return { table, scenarios: {}, getState: () => ({ scenario: null, overrides: {} }) }
}

function makeApp(overrides: Partial<PublicRuntime> = {}) {
  return createPublicApp({
    mock: makeMock(),
    token: TOKEN,
    origins: ['https://app.example.com'],
    ...overrides,
  })
}

const auth = { Authorization: `Bearer ${TOKEN}` }

describe('the tunnel surface serves mocks', () => {
  it('serves a mock with a valid token', async () => {
    const res = await makeApp().request('/users', { headers: auth })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ items: [] })
  })

  it('still 404s an unknown mock route, with the mock app body', async () => {
    const res = await makeApp().request('/nope', { headers: auth })
    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ error: 'laqi', message: 'no matching route' })
  })
})

describe('H1 — the control plane never reaches the tunnel', () => {
  it('404s every control plane route, even with a valid token', async () => {
    const app = makeApp()

    for (const path of [
      '/__laqi',
      '/__laqi/',
      '/__laqi/api/endpoints',
      '/__laqi/api/state',
      '/__laqi/api/status',
      '/__laqi/api/scenarios',
      '/__laqi/events',
      '/__laqi/assets/index.js',
    ]) {
      const res = await app.request(path, { headers: auth })
      expect(res.status, path).toBe(404)
    }
  })

  it('404s a write to the control plane, and never reaches a handler', async () => {
    const res = await makeApp().request('/__laqi/api/endpoints', {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'GET', path: '/stolen', default: 'ok', responses: { ok: { status: 200 } } }),
    })
    expect(res.status).toBe(404)
  })

  it('answers 404 and not 403, so it does not confirm the control plane exists', async () => {
    const res = await makeApp().request('/__laqi/api/status')
    expect(res.status).toBe(404)
    expect(res.status).not.toBe(403)
    expect(res.status).not.toBe(401)
  })

  it('is structural: even if a control plane were mounted, the 404 wins', async () => {
    // Defensa en profundidad. La garantía real es que el puerto público no
    // monta el control plane — esto cubre el día que alguien lo monte mal.
    const app = createPublicApp({ mock: makeMock(), token: null, origins: [] })
    app.route(
      '/__laqi',
      createControlPlaneApp({
        getEndpoints: () => endpoints,
        getState: () => ({ scenario: null, overrides: {} }),
        setState: () => {},
        getScenarios: () => ({}),
        getStatus: () => ({ watching: 'laqi', endpointCount: 1, address: 'x', errors: [] }),
        createEndpoint: () => ({ ok: true, id: 'x' }),
        updateEndpoint: () => ({ ok: true }),
        deleteEndpoint: () => ({ ok: true }),
        subscribe: () => () => {},
      }),
    )

    const res = await app.request('/__laqi/api/endpoints')
    expect(res.status).toBe(404)
  })
})

describe('bearer token', () => {
  it('401s a request with no token', async () => {
    const res = await makeApp().request('/users')
    expect(res.status).toBe(401)
    expect(res.headers.get('WWW-Authenticate')).toBe('Bearer')
  })

  it('401s a wrong token', async () => {
    const res = await makeApp().request('/users', { headers: { Authorization: 'Bearer nope' } })
    expect(res.status).toBe(401)
  })

  it('401s a token of the right length but wrong content', async () => {
    const wrong = 'a'.repeat(TOKEN.length)
    const res = await makeApp().request('/users', { headers: { Authorization: `Bearer ${wrong}` } })
    expect(res.status).toBe(401)
  })

  it('401s a correct token sent without the Bearer scheme', async () => {
    const res = await makeApp().request('/users', { headers: { Authorization: TOKEN } })
    expect(res.status).toBe(401)
  })

  it('lets the CORS preflight through — a browser never sends Authorization on it', async () => {
    const res = await makeApp().request('/users', {
      method: 'OPTIONS',
      headers: { Origin: 'https://app.example.com', 'Access-Control-Request-Method': 'GET' },
    })
    expect(res.status).not.toBe(401)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example.com')
  })

  it('serves without a token only when one was explicitly not set', async () => {
    const res = await makeApp({ token: null }).request('/users')
    expect(res.status).toBe(200)
  })
})

describe('CORS in shared mode', () => {
  it('echoes an allowed origin', async () => {
    const res = await makeApp().request('/users', {
      headers: { ...auth, Origin: 'https://app.example.com' },
    })
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example.com')
  })

  it('never answers with a wildcard', async () => {
    const res = await makeApp().request('/users', { headers: { ...auth, Origin: 'https://evil.example' } })
    expect(res.headers.get('Access-Control-Allow-Origin')).not.toBe('*')
  })

  it('refuses an origin that is not declared', async () => {
    const res = await makeApp().request('/users', { headers: { ...auth, Origin: 'https://evil.example' } })
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })
})

describe('rate limiting', () => {
  const limit = { windowMs: 1000, max: 3, globalMax: 100 }

  it('429s once one caller passes its window limit', async () => {
    const app = makeApp({ token: null, rateLimit: limit })
    const headers = { 'CF-Connecting-IP': '203.0.113.9' }

    for (let i = 0; i < 3; i++) {
      expect((await app.request('/users', { headers })).status).toBe(200)
    }

    const blocked = await app.request('/users', { headers })
    expect(blocked.status).toBe(429)
    expect(Number(blocked.headers.get('Retry-After'))).toBeGreaterThan(0)
  })

  it('keeps separate budgets per caller', async () => {
    const app = makeApp({ token: null, rateLimit: limit })

    for (let i = 0; i < 3; i++) {
      await app.request('/users', { headers: { 'CF-Connecting-IP': '203.0.113.9' } })
    }

    const other = await app.request('/users', { headers: { 'CF-Connecting-IP': '198.51.100.4' } })
    expect(other.status).toBe(200)
  })

  it('lets the window expire', async () => {
    let clock = 0
    const app = makeApp({ token: null, rateLimit: limit, now: () => clock })
    const headers = { 'CF-Connecting-IP': '203.0.113.9' }

    for (let i = 0; i < 3; i++) await app.request('/users', { headers })
    expect((await app.request('/users', { headers })).status).toBe(429)

    clock += 1001
    expect((await app.request('/users', { headers })).status).toBe(200)
  })

  it('a rotated CF-Connecting-IP still hits the global ceiling', async () => {
    // El header lo fija cloudflared, pero quien llegue directo al puerto
    // podría inventarlo. Rotarlo esquiva el bucket propio, no el global.
    const app = makeApp({ token: null, rateLimit: { windowMs: 1000, max: 2, globalMax: 5 } })

    const statuses: number[] = []
    for (let i = 0; i < 8; i++) {
      const res = await app.request('/users', { headers: { 'CF-Connecting-IP': `203.0.113.${i}` } })
      statuses.push(res.status)
    }

    expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0)
    expect(statuses.slice(0, 5).every((s) => s === 200)).toBe(true)
  })

  it('rate limits before authenticating, so a flood of bad tokens is cheap', async () => {
    const app = makeApp({ rateLimit: limit })
    const headers = { 'CF-Connecting-IP': '203.0.113.9' }

    for (let i = 0; i < 3; i++) {
      expect((await app.request('/users', { headers })).status).toBe(401)
    }
    expect((await app.request('/users', { headers })).status).toBe(429)
  })
})

describe('generateToken', () => {
  it('produces 32 hex characters', () => {
    expect(generateToken()).toMatch(/^[0-9a-f]{32}$/)
  })

  it('does not repeat', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => generateToken()))
    expect(tokens.size).toBe(200)
  })
})

describe('OPTIONS mocks survive the tunnel', () => {
  const optionsEndpoint: LoadedEndpoint = {
    id: 'OPTIONS /probe',
    method: 'OPTIONS',
    path: '/probe',
    default: 'ok',
    responses: { ok: { status: 200, body: { allowed: ['GET'] } } },
    file: 'laqi/api.json',
    line: 9,
  }

  function withOptionsMock() {
    const { table } = buildRouteTable([...endpoints, optionsEndpoint])
    return {
      table,
      scenarios: {},
      getState: () => ({ scenario: null, overrides: {} }),
    }
  }

  it('serves a declared OPTIONS mock instead of a bare CORS 204', async () => {
    // createMockApp registra los mocks OPTIONS antes de su propio cors()
    // para que sean alcanzables. Un cors() en la app pública lo deshacía:
    // el mock andaba en local y devolvía 204 vacío por el túnel.
    const app = createPublicApp({ mock: withOptionsMock(), token: null, origins: [] })
    const res = await app.request('/probe', { method: 'OPTIONS' })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ allowed: ['GET'] })
  })

  it('still answers a normal preflight for a path with no OPTIONS mock', async () => {
    const app = createPublicApp({
      mock: withOptionsMock(),
      token: null,
      origins: ['https://app.example.com'],
    })
    const res = await app.request('/users', {
      method: 'OPTIONS',
      headers: { Origin: 'https://app.example.com', 'Access-Control-Request-Method': 'GET' },
    })
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example.com')
  })
})

describe('rate limiter memory', () => {
  it('does not grow without bound when the caller rotates its IP header', async () => {
    const app = createPublicApp({
      mock: makeMock(),
      token: null,
      origins: [],
      rateLimit: { windowMs: 60_000, max: 5, globalMax: 100_000 },
    })

    // Muchas más requests que el techo de buckets, cada una con una IP nueva.
    for (let i = 0; i < MAX_BUCKETS + 500; i++) {
      await app.request('/users', { headers: { 'CF-Connecting-IP': `10.0.${i >> 8}.${i & 255}` } })
    }

    // No se puede leer el Map desde afuera, así que se verifica lo que
    // importa: el proceso sigue vivo y respondiendo.
    expect((await app.request('/users', { headers: { 'CF-Connecting-IP': '10.9.9.9' } })).status).toBe(200)
  })

  it('still enforces the global ceiling after a sweep', async () => {
    let clock = 0
    const app = createPublicApp({
      mock: makeMock(),
      token: null,
      origins: [],
      rateLimit: { windowMs: 1000, max: 2, globalMax: 6 },
      now: () => clock,
    })

    const statuses: number[] = []
    for (let i = 0; i < 10; i++) {
      statuses.push((await app.request('/users', { headers: { 'CF-Connecting-IP': `10.0.0.${i}` } })).status)
    }
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0)
  })
})
