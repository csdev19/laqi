// apps/cli/src/serve.test.ts
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ConfigSchema } from '@laqi/schema'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isLoopback, startServer, type ServeHandle } from './serve'

let root: string
let handle: ServeHandle | undefined

const config = ConfigSchema.parse({ port: 0, host: '127.0.0.1' })

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'laqi-serve-'))
  mkdirSync(join(root, 'laqi'), { recursive: true })
})

afterEach(async () => {
  await handle?.close()
  handle = undefined
  rmSync(root, { recursive: true, force: true })
})

function writeMocks(contents: Record<string, unknown>) {
  writeFileSync(join(root, 'laqi', 'api.json'), JSON.stringify(contents), 'utf8')
}

const get = (path: string) => fetch(`http://127.0.0.1:${handle?.port}${path}`)

describe('startServer', () => {
  it('serves a loaded endpoint', async () => {
    writeMocks({ 'GET /users': { default: 'ok', responses: { ok: { status: 200, body: [] } } } })
    handle = await startServer({ root, config })

    const res = await get('/users')
    expect(res.status).toBe(200)
    expect(res.headers.get('X-Laqi-Resolved')).toBe('ok (default)')
  })

  it('starts even with no mock files at all (F9)', async () => {
    handle = await startServer({ root, config })
    expect((await get('/anything')).status).toBe(404)
  })

  it('picks up a new endpoint on reload, on the same port', async () => {
    writeMocks({ 'GET /users': { default: 'ok', responses: { ok: { status: 200, body: [] } } } })
    handle = await startServer({ root, config })
    const port = handle.port

    expect((await get('/orders')).status).toBe(404)

    writeMocks({
      'GET /users': { default: 'ok', responses: { ok: { status: 200, body: [] } } },
      'GET /orders': { default: 'ok', responses: { ok: { status: 200, body: [] } } },
    })
    handle.reload()

    expect(handle.port).toBe(port)
    expect((await get('/orders')).status).toBe(200)
  })

  it('survives rapid consecutive reloads without EADDRINUSE (v1 defect H)', async () => {
    writeMocks({ 'GET /users': { default: 'ok', responses: { ok: { status: 200, body: [] } } } })
    handle = await startServer({ root, config })

    for (let i = 0; i < 10; i++) handle.reload()

    expect((await get('/users')).status).toBe(200)
  })

  it('keeps serving valid files when one is broken (H3)', async () => {
    writeMocks({ 'GET /users': { default: 'ok', responses: { ok: { status: 200, body: [] } } } })
    writeFileSync(join(root, 'laqi', 'broken.json'), '{ nope', 'utf8')
    handle = await startServer({ root, config })

    expect((await get('/users')).status).toBe(200)
    expect(handle.current().errors).toHaveLength(1)
  })

  it('exposes load errors through the handle for the panel to render', async () => {
    writeFileSync(join(root, 'laqi', 'broken.json'), '{\n  "a": 1,\n}\n', 'utf8')
    handle = await startServer({ root, config })

    const [error] = handle.current().errors
    expect(error?.file).toContain('broken.json')
    expect(error?.excerpt).toContain('^')
  })

  it('rejects instead of hanging forever when the port is already in use (C3)', async () => {
    handle = await startServer({ root, config })
    const busyPort = handle.port

    const otherRoot = mkdtempSync(join(tmpdir(), 'laqi-serve-'))
    mkdirSync(join(otherRoot, 'laqi'), { recursive: true })
    try {
      await expect(
        startServer({
          root: otherRoot,
          config: ConfigSchema.parse({ port: busyPort, host: '127.0.0.1' }),
        }),
      ).rejects.toThrow()
    } finally {
      rmSync(otherRoot, { recursive: true, force: true })
    }
  }, 5000)
})

describe('control plane, mounted under /__laqi', () => {
  it('lists the loaded endpoints', async () => {
    writeMocks({ 'GET /users': { default: 'ok', responses: { ok: { status: 200, body: [] } } } })
    handle = await startServer({ root, config })

    const res = await get('/__laqi/api/endpoints')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { id: string }[]
    expect(body.map((e) => e.id)).toEqual(['GET /users'])
  })

  it('flips the live response via PUT /api/state, and the mock reflects it immediately', async () => {
    writeMocks({
      'GET /users': {
        default: 'ok',
        responses: { ok: { status: 200, body: [] }, boom: { status: 500, body: {} } },
      },
    })
    handle = await startServer({ root, config })

    const put = await fetch(`http://127.0.0.1:${handle!.port}/__laqi/api/state`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scenario: null, overrides: { 'GET /users': 'boom' } }),
    })
    expect(put.status).toBe(200)

    const res = await get('/users')
    expect(res.status).toBe(500)
    expect(res.headers.get('X-Laqi-Resolved')).toBe('boom (state)')
  })

  it('creates an endpoint via POST, and it is immediately servable — no restart, no wait for the watcher', async () => {
    writeMocks({ 'GET /users': { default: 'ok', responses: { ok: { status: 200, body: [] } } } })
    handle = await startServer({ root, config })

    const post = await fetch(`http://127.0.0.1:${handle!.port}/__laqi/api/endpoints`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        method: 'GET',
        path: '/orders',
        default: 'ok',
        responses: { ok: { status: 200, body: [] } },
      }),
    })
    expect(post.status).toBe(201)

    const res = await get('/orders')
    expect(res.status).toBe(200)
  })

  it('updates an endpoint via PUT, immediately reflected', async () => {
    writeMocks({
      'GET /users': { default: 'ok', responses: { ok: { status: 200, body: [{ id: 1 }] } } },
    })
    handle = await startServer({ root, config })

    const put = await fetch(
      `http://127.0.0.1:${handle!.port}/__laqi/api/endpoints/${encodeURIComponent('GET /users')}`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ default: 'ok', responses: { ok: { status: 200, body: [] } } }),
      },
    )
    expect(put.status).toBe(200)

    const res = await get('/users')
    expect(await res.json()).toEqual([])
  })

  it('deletes an endpoint via DELETE, immediately gone', async () => {
    writeMocks({
      'GET /users': { default: 'ok', responses: { ok: { status: 200, body: [] } } },
      'GET /orders': { default: 'ok', responses: { ok: { status: 200, body: [] } } },
    })
    handle = await startServer({ root, config })

    const del = await fetch(
      `http://127.0.0.1:${handle!.port}/__laqi/api/endpoints/${encodeURIComponent('GET /orders')}`,
      { method: 'DELETE' },
    )
    expect(del.status).toBe(204)

    expect((await get('/orders')).status).toBe(404)
    expect((await get('/users')).status).toBe(200)
  })

  it('streams a request event over SSE when a mock is hit', async () => {
    writeMocks({ 'GET /users': { default: 'ok', responses: { ok: { status: 200, body: [] } } } })
    handle = await startServer({ root, config })

    const sse = await fetch(`http://127.0.0.1:${handle!.port}/__laqi/events`)
    const reader = sse.body!.getReader()
    const decoder = new TextDecoder()

    await new Promise((resolve) => setTimeout(resolve, 20))
    await get('/users')

    const { value } = await reader.read()
    const text = decoder.decode(value)
    expect(text).toContain('event: request')
    expect(text).toContain('"path":"/users"')

    await reader.cancel()
  })

  it('a mock endpoint can never be created under the reserved /__laqi prefix', async () => {
    handle = await startServer({ root, config })

    const post = await fetch(`http://127.0.0.1:${handle!.port}/__laqi/api/endpoints`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        method: 'GET',
        path: '/__laqi/panel',
        default: 'ok',
        responses: { ok: { status: 200, body: {} } },
      }),
    })

    // The create route explicitly rejects the reserved prefix BEFORE
    // writing anything — no LOAD FAILED to clean up by hand, no file
    // contaminated with a dead entry.
    expect(post.status).toBe(400)
    const status = await (await get('/__laqi/api/status')).json()
    expect((status as { errors: unknown[] }).errors).toHaveLength(0)
    expect((await get('/__laqi/panel')).status).not.toBe(200)
  })

  it('rejects creating an id that already exists in a DIFFERENT mock file, without touching the existing endpoint (cross-file duplicate)', async () => {
    // Folder mode: every new endpoint goes to laqi/api.json, so an id that
    // already exists in laqi/users.json must be rejected BEFORE writing —
    // otherwise buildRouteTable sees the cross-file duplicate and drops
    // BOTH sides, killing the endpoint that already worked.
    writeFileSync(
      join(root, 'laqi', 'users.json'),
      JSON.stringify({
        'GET /users': { default: 'ok', responses: { ok: { status: 200, body: [] } } },
      }),
      'utf8',
    )
    handle = await startServer({ root, config })

    expect((await get('/users')).status).toBe(200)

    const post = await fetch(`http://127.0.0.1:${handle!.port}/__laqi/api/endpoints`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        method: 'GET',
        path: '/users',
        default: 'ok',
        responses: { ok: { status: 200, body: [] } },
      }),
    })
    expect(post.status).toBe(409)

    expect((await get('/users')).status).toBe(200)
    const status = (await (await get('/__laqi/api/status')).json()) as {
      endpointCount: number
      errors: unknown[]
    }
    expect(status.endpointCount).toBe(1)
    expect(status.errors).toHaveLength(0)
  })
})

describe('control plane mount is restricted to loopback hosts', () => {
  it('does not mount /__laqi on a non-loopback host — falls through to the mock app 404', async () => {
    writeMocks({ 'GET /users': { default: 'ok', responses: { ok: { status: 200, body: [] } } } })
    // The mount check is purely on the config.host string, not on the
    // actual binding — 0.0.0.0 with an ephemeral port is still reachable
    // via 127.0.0.1 (0.0.0.0 listens on every interface, loopback
    // included), so we don't need a real LAN IP to test this.
    const nonLoopbackConfig = ConfigSchema.parse({ port: 0, host: '0.0.0.0' })
    handle = await startServer({ root, config: nonLoopbackConfig })

    const controlPlaneRes = await fetch(`http://127.0.0.1:${handle.port}/__laqi/api/endpoints`)
    expect(controlPlaneRes.status).toBe(404)

    const mockRes = await fetch(`http://127.0.0.1:${handle.port}/users`)
    expect(mockRes.status).toBe(200)
  })
})

describe('startServer with --share (H1)', () => {
  const shared = (over: Partial<{ token: string | null; origins: string[] }> = {}) => ({
    port: 0,
    token: 'testtoken' as string | null,
    origins: [] as string[],
    ...over,
  })

  const publicGet = (path: string, init?: RequestInit) =>
    fetch(`http://127.0.0.1:${handle?.publicPort}${path}`, init)

  const auth = { Authorization: 'Bearer testtoken' }

  it('serves mocks on the public port only with a token', async () => {
    writeMocks({ 'GET /users': { default: 'ok', responses: { ok: { status: 200, body: [] } } } })
    handle = await startServer({ root, config, share: shared() })

    expect((await publicGet('/users', { headers: auth })).status).toBe(200)
    expect((await publicGet('/users')).status).toBe(401)
  })

  it('never exposes the control plane on the public port, even with a valid token', async () => {
    writeMocks({ 'GET /users': { default: 'ok', responses: { ok: { status: 200 } } } })
    handle = await startServer({ root, config, share: shared() })

    for (const path of [
      '/__laqi',
      '/__laqi/api/endpoints',
      '/__laqi/api/status',
      '/__laqi/events',
    ]) {
      expect((await publicGet(path, { headers: auth })).status, `public ${path}`).toBe(404)
    }

    // But it does on the local port — which is exactly the point of having two.
    expect((await get('/__laqi/api/status')).status).toBe(200)
  })

  it('leaves the mock files byte-identical after a write attempt through the tunnel', async () => {
    writeMocks({ 'GET /users': { default: 'ok', responses: { ok: { status: 200 } } } })
    handle = await startServer({ root, config, share: shared() })
    const before = readFileSync(join(root, 'laqi', 'api.json'), 'utf8')

    const res = await publicGet('/__laqi/api/endpoints', {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        method: 'GET',
        path: '/stolen',
        default: 'ok',
        responses: { ok: { status: 200 } },
      }),
    })

    expect(res.status).toBe(404)
    expect(readFileSync(join(root, 'laqi', 'api.json'), 'utf8')).toBe(before)
  })

  it('reports the share state to the panel, including the H1 guarantee in words', async () => {
    writeMocks({ 'GET /x': { default: 'ok', responses: { ok: { status: 200 } } } })
    handle = await startServer({ root, config, share: shared() })
    handle.setShareUrl('https://shy-forest-1234.trycloudflare.com')

    const status = (await (await get('/__laqi/api/status')).json()) as {
      share: { url: string; token: string; exposed: string }
    }
    expect(status.share).toMatchObject({
      url: 'https://shy-forest-1234.trycloudflare.com',
      token: 'testtoken',
    })
    expect(status.share.exposed).toContain('not exposed')
  })

  it('says share is null when --share was not asked for', async () => {
    writeMocks({ 'GET /x': { default: 'ok', responses: { ok: { status: 200 } } } })
    handle = await startServer({ root, config })

    const status = (await (await get('/__laqi/api/status')).json()) as { share: unknown }
    expect(status.share).toBeNull()
  })

  it('keeps the tunnel surface correct across a hot reload', async () => {
    writeMocks({ 'GET /a': { default: 'ok', responses: { ok: { status: 200 } } } })
    handle = await startServer({ root, config, share: shared() })
    expect((await publicGet('/a', { headers: auth })).status).toBe(200)

    writeMocks({
      'GET /a': { default: 'ok', responses: { ok: { status: 200 } } },
      'GET /b': { default: 'ok', responses: { ok: { status: 201 } } },
    })
    handle.reload()

    expect((await publicGet('/b', { headers: auth })).status).toBe(201)
    // And the guarantee still holds after rebuilding the app.
    expect((await publicGet('/__laqi/api/status', { headers: auth })).status).toBe(404)
  })

  it('never answers a wildcard CORS through the tunnel', async () => {
    writeMocks({ 'GET /x': { default: 'ok', responses: { ok: { status: 200 } } } })
    handle = await startServer({
      root,
      config,
      share: shared({ origins: ['https://app.example.com'] }),
    })

    const allowed = await publicGet('/x', {
      headers: { ...auth, Origin: 'https://app.example.com' },
    })
    expect(allowed.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example.com')

    const evil = await publicGet('/x', { headers: { ...auth, Origin: 'https://evil.example' } })
    expect(evil.headers.get('Access-Control-Allow-Origin')).not.toBe('*')
  })

  it('closes both listeners', async () => {
    writeMocks({ 'GET /x': { default: 'ok', responses: { ok: { status: 200 } } } })
    handle = await startServer({ root, config, share: shared({ token: null }) })
    const publicPort = handle.publicPort!

    await handle.close()
    handle = undefined

    await expect(fetch(`http://127.0.0.1:${publicPort}/x`)).rejects.toThrow()
  })
})

describe('the control plane and the MCP server share one implementation', () => {
  // These used to be two copies that had already diverged. These tests
  // pin the two rules the control plane's copy was missing.
  it('refuses a path the loader would reject, instead of writing a dead endpoint', async () => {
    writeMocks({ 'GET /x': { default: 'ok', responses: { ok: { status: 200 } } } })
    handle = await startServer({ root, config })
    const before = readFileSync(join(root, 'laqi', 'api.json'), 'utf8')

    for (const path of ['/my orders', '/../evil']) {
      const res = await fetch(`http://127.0.0.1:${handle.port}/__laqi/api/endpoints`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'GET',
          path,
          default: 'ok',
          responses: { ok: { status: 200 } },
        }),
      })
      expect(res.status, path).not.toBe(201)
    }

    expect(readFileSync(join(root, 'laqi', 'api.json'), 'utf8')).toBe(before)
    // And no error band shows up: nothing broken was ever written.
    const status = (await (await get('/__laqi/api/status')).json()) as { errors: unknown[] }
    expect(status.errors).toEqual([])
  })

  it('drops the override when an endpoint is deleted through the panel', async () => {
    writeMocks({
      'GET /users': { default: 'ok', responses: { ok: { status: 200 }, boom: { status: 500 } } },
    })
    handle = await startServer({ root, config })

    await fetch(`http://127.0.0.1:${handle.port}/__laqi/api/state`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenario: null, overrides: { 'GET /users': 'boom' } }),
    })

    const deleted = await fetch(
      `http://127.0.0.1:${handle.port}/__laqi/api/endpoints/${encodeURIComponent('GET /users')}`,
      { method: 'DELETE' },
    )
    expect(deleted.status).toBe(204)

    // Without this, recreating the endpoint later revives it serving "boom".
    const state = (await (await get('/__laqi/api/state')).json()) as {
      overrides: Record<string, string>
    }
    expect(state.overrides).toEqual({})
  })
})

describe('the address the panel shows', () => {
  it('reports the port actually bound, not the configured one', async () => {
    // config.port is 0 in every one of these tests: the OS assigns the
    // real one. The panel used to show "127.0.0.1:0" and the curl it
    // offered to copy would fail.
    writeMocks({ 'GET /x': { default: 'ok', responses: { ok: { status: 200 } } } })
    handle = await startServer({ root, config })

    const status = (await (await get('/__laqi/api/status')).json()) as { address: string }
    expect(status.address).toBe(`127.0.0.1:${handle.port}`)
    expect(status.address).not.toContain(':0')
  })
})

describe('close() with a live SSE client', () => {
  it('resolves instead of hanging forever', async () => {
    writeMocks({ 'GET /x': { default: 'ok', responses: { ok: { status: 200 } } } })
    const local = await startServer({ root, config })

    // A panel tab left open: the /events stream doesn't end on its own.
    const res = await fetch(`http://127.0.0.1:${local.port}/__laqi/events`)
    res
      .body!.getReader()
      .read()
      .catch(() => {})
    await new Promise((r) => setTimeout(r, 100))

    const closed = local.close().then(() => 'closed' as const)
    const timeout = new Promise<'hung'>((r) => setTimeout(() => r('hung'), 3000))
    expect(await Promise.race([closed, timeout])).toBe('closed')
  })
})

describe('the panel is mounted on every loopback address', () => {
  it('mounts on ::1, not only 127.0.0.1 and localhost', async () => {
    // `--host ::1` is loopback: it exposes nothing to the network. Leaving
    // it out silently disabled the panel and made it look broken.
    writeMocks({ 'GET /x': { default: 'ok', responses: { ok: { status: 200 } } } })
    handle = await startServer({ root, config: ConfigSchema.parse({ port: 0, host: '::1' }) })

    const res = await fetch(`http://[::1]:${handle.port}/__laqi/api/status`)
    expect(res.status).toBe(200)
  })

  it('classifies the loopback range correctly', () => {
    for (const host of ['127.0.0.1', '127.0.0.53', 'localhost', 'LOCALHOST', '::1', '[::1]']) {
      expect(isLoopback(host), host).toBe(true)
    }
    for (const host of ['0.0.0.0', '192.168.1.10', '10.0.0.1', '::', 'example.com']) {
      expect(isLoopback(host), host).toBe(false)
    }
  })
})

describe('when the share listener cannot bind', () => {
  it('does not leave the main listener running behind a thrown error', async () => {
    writeMocks({ 'GET /x': { default: 'ok', responses: { ok: { status: 200 } } } })

    // A free and KNOWN port for the main listener: if a failed startup
    // leaves it open, the second attempt collides with itself.
    const probe = await startServer({ root, config: ConfigSchema.parse({ port: 0 }) })
    const mainPort = probe.port
    await probe.close()

    // And a busy port so the tunnel listener fails.
    const blocker = await startServer({ root, config: ConfigSchema.parse({ port: 0 }) })

    try {
      await expect(
        startServer({
          root,
          config: ConfigSchema.parse({ port: mainPort }),
          share: { port: blocker.port, token: null, origins: [] },
        }),
      ).rejects.toThrow()

      // If the main one stayed hanging open, this startup throws
      // EADDRINUSE. The real process, moreover, would never terminate:
      // the orphan listener keeps the event loop alive after saying it failed.
      handle = await startServer({ root, config: ConfigSchema.parse({ port: mainPort }) })
      expect((await fetch(`http://127.0.0.1:${mainPort}/x`)).status).toBe(200)
    } finally {
      await blocker.close()
    }
  })
})

describe('the rate limiter survives a reload', () => {
  it('does not hand a limited client its quota back when a file is saved', async () => {
    writeMocks({ 'GET /ping': { default: 'ok', responses: { ok: { status: 200 } } } })
    handle = await startServer({
      root,
      config,
      share: { port: 0, token: null, origins: [] },
    })

    const url = `http://127.0.0.1:${handle.publicPort}/ping`
    const headers = { 'CF-Connecting-IP': '203.0.113.9' }

    let blocked = false
    for (let i = 0; i < 400 && !blocked; i++) {
      blocked = (await fetch(url, { headers })).status === 429
    }
    expect(blocked).toBe(true)

    // A local save must not be a way to reset the rate limit for someone
    // out on the internet.
    handle.reload()
    expect((await fetch(url, { headers })).status).toBe(429)
  })
})

describe('which listener failed', () => {
  it('marks a share-listener failure so the CLI blames the right port', async () => {
    writeMocks({ 'GET /x': { default: 'ok', responses: { ok: { status: 200 } } } })
    const blocker = await startServer({ root, config })

    try {
      // The tunnel port is busy; the main one is free.
      const error = await startServer({
        root,
        config,
        share: { port: blocker.port, token: null, origins: [] },
      }).then(
        () => null,
        (thrown: unknown) => thrown,
      )

      expect((error as { laqiListener?: string }).laqiListener).toBe('share')
    } finally {
      await blocker.close()
    }
  })

  it('leaves a main-listener failure unmarked, so it blames --port', async () => {
    writeMocks({ 'GET /x': { default: 'ok', responses: { ok: { status: 200 } } } })
    const blocker = await startServer({ root, config })

    try {
      const error = await startServer({
        root,
        // Now it's the main one that's busy.
        config: ConfigSchema.parse({ port: blocker.port }),
        share: { port: 0, token: null, origins: [] },
      }).then(
        () => null,
        (thrown: unknown) => thrown,
      )

      expect((error as { laqiListener?: string }).laqiListener).toBeUndefined()
    } finally {
      await blocker.close()
    }
  })
})

describe('generation through a live server', () => {
  it('derives types from the live response body', async () => {
    writeMocks({
      'GET /users': {
        default: 'ok',
        responses: { ok: { status: 200, body: [{ id: 1, name: 'Ada' }] } },
      },
    })
    handle = await startServer({ root, config })

    const res = await get(
      `/__laqi/api/endpoints/${encodeURIComponent('GET /users')}/types?response=ok`,
    )
    expect(res.status).toBe(200)
    const { code, language } = (await res.json()) as { code: string; language: string }
    expect(language).toBe('typescript')
    expect(code).toContain('id')
    expect(code).toContain('name')
  }, 30_000)

  it('404s types for an endpoint or response that does not exist', async () => {
    writeMocks({ 'GET /x': { default: 'ok', responses: { ok: { status: 200 } } } })
    handle = await startServer({ root, config })
    expect((await get('/__laqi/api/endpoints/GET%20%2Fnope/types')).status).toBe(404)
    expect((await get('/__laqi/api/endpoints/GET%20%2Fx/types?response=ghost')).status).toBe(404)
  })

  it('generates a preview from a pasted model, and the same seed repeats it', async () => {
    writeMocks({ 'GET /x': { default: 'ok', responses: { ok: { status: 200 } } } })
    handle = await startServer({ root, config })

    const body = JSON.stringify({
      model: 'export interface Todo { id: number; title: string; done: boolean }',
      seed: 42,
    })
    const once = await fetch(`http://127.0.0.1:${handle.port}/__laqi/api/generate/data`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    })
    expect(once.status).toBe(200)
    const first = (await once.json()) as { preview: Record<string, unknown>; warnings: string[] }
    expect(typeof first.preview.id).toBe('number')
    expect(typeof first.preview.title).toBe('string')

    const twice = await fetch(`http://127.0.0.1:${handle.port}/__laqi/api/generate/data`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    })
    expect(((await twice.json()) as { preview: unknown }).preview).toEqual(first.preview)
  }, 30_000)

  it('regenerates from live data via from:, without any model', async () => {
    writeMocks({
      'GET /users': {
        default: 'ok',
        responses: { ok: { status: 200, body: [{ id: 1, name: 'Ada' }] } },
      },
    })
    handle = await startServer({ root, config })

    const res = await fetch(`http://127.0.0.1:${handle.port}/__laqi/api/generate/data`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: { endpointId: 'GET /users', response: 'ok' },
        seed: 7,
        arrayLength: 2,
      }),
    })
    expect(res.status).toBe(200)
    const { preview } = (await res.json()) as { preview: Record<string, unknown>[] }
    expect(preview).toHaveLength(2)
    expect(typeof preview[0]!.id).toBe('number')
    expect(typeof preview[0]!.name).toBe('string')
  }, 30_000)

  // Finding 5: generateData had no try/catch around its calls into
  // @laqi/generate, unlike its twin getTypes — any failure there escaped
  // the callback and fell through to Hono's default handler as a bare
  // 500 with no body. Both branches now mirror getTypes.

  it('400s the from: branch with a real message on pathologically nested data, instead of a bare 500', async () => {
    // Deep enough to clear the depth guard's MAX_DEPTH (500) with room to
    // spare, but shallow enough that building/serialising the fixture
    // itself (JSON.stringify in writeMocks) doesn't hit its own stack limit.
    let deep: unknown = 'leaf'
    for (let i = 0; i < 2_000; i++) deep = { child: deep }
    writeMocks({ 'GET /deep': { default: 'ok', responses: { ok: { status: 200, body: deep } } } })
    handle = await startServer({ root, config })

    const res = await fetch(`http://127.0.0.1:${handle.port}/__laqi/api/generate/data`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: { endpointId: 'GET /deep', response: 'ok' } }),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { message: string }
    expect(body.message).toMatch(/nesting|depth/i)
  }, 30_000)

  it('400s the model branch with a real message on a genuine generation failure, instead of a bare 500', async () => {
    writeMocks({ 'GET /x': { default: 'ok', responses: { ok: { status: 200 } } } })
    handle = await startServer({ root, config })

    // string[][][] at arrayLength 100 blows the generation budget
    // (100^3 = 1,000,000 leaf values) — a genuine @laqi/generate failure
    // reachable through the public API, same amplification case as
    // finding 2 in packages/generate.
    const res = await fetch(`http://127.0.0.1:${handle.port}/__laqi/api/generate/data`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'export interface Big { a: string[][][] }',
        arrayLength: 100,
      }),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { message: string }
    expect(body.message).toMatch(/more than 100000 values/)
  }, 30_000)
})
