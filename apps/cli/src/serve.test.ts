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
        startServer({ root: otherRoot, config: ConfigSchema.parse({ port: busyPort, host: '127.0.0.1' }) }),
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

    // La ruta de creación rechaza explícitamente el prefijo reservado ANTES
    // de escribir nada — no hay LOAD FAILED que limpiar a mano, ni archivo
    // contaminado con una entrada muerta.
    expect(post.status).toBe(400)
    const status = await (await get('/__laqi/api/status')).json()
    expect((status as { errors: unknown[] }).errors).toHaveLength(0)
    expect((await get('/__laqi/panel')).status).not.toBe(200)
  })

  it('rejects creating an id that already exists in a DIFFERENT mock file, without touching the existing endpoint (cross-file duplicate)', async () => {
    // Modo carpeta: todo endpoint nuevo va a laqi/api.json, así que un id
    // preexistente en laqi/users.json debe rechazarse ANTES de escribir —
    // si no, buildRouteTable ve el duplicado cross-file y descarta AMBOS
    // lados, matando el endpoint que ya funcionaba.
    writeFileSync(
      join(root, 'laqi', 'users.json'),
      JSON.stringify({ 'GET /users': { default: 'ok', responses: { ok: { status: 200, body: [] } } } }),
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
    const status = (await (await get('/__laqi/api/status')).json()) as { endpointCount: number; errors: unknown[] }
    expect(status.endpointCount).toBe(1)
    expect(status.errors).toHaveLength(0)
  })
})

describe('control plane mount is restricted to loopback hosts', () => {
  it('does not mount /__laqi on a non-loopback host — falls through to the mock app 404', async () => {
    writeMocks({ 'GET /users': { default: 'ok', responses: { ok: { status: 200, body: [] } } } })
    // El chequeo de mount es puramente sobre el string config.host, no sobre
    // el binding real — 0.0.0.0 con puerto efímero sigue siendo alcanzable
    // vía 127.0.0.1 (0.0.0.0 escucha en todas las interfaces, loopback
    // incluida), así que no hace falta una IP de LAN real para probar esto.
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

    for (const path of ['/__laqi', '/__laqi/api/endpoints', '/__laqi/api/status', '/__laqi/events']) {
      expect((await publicGet(path, { headers: auth })).status, `public ${path}`).toBe(404)
    }

    // Pero sí en el puerto local — que es exactamente el punto de tener dos.
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
    // Y la garantía sigue en pie tras reconstruir la app.
    expect((await publicGet('/__laqi/api/status', { headers: auth })).status).toBe(404)
  })

  it('never answers a wildcard CORS through the tunnel', async () => {
    writeMocks({ 'GET /x': { default: 'ok', responses: { ok: { status: 200 } } } })
    handle = await startServer({ root, config, share: shared({ origins: ['https://app.example.com'] }) })

    const allowed = await publicGet('/x', { headers: { ...auth, Origin: 'https://app.example.com' } })
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
  // Antes eran dos copias y ya habían divergido. Estos tests fijan las dos
  // reglas que a la copia del control plane le faltaban.
  it('refuses a path the loader would reject, instead of writing a dead endpoint', async () => {
    writeMocks({ 'GET /x': { default: 'ok', responses: { ok: { status: 200 } } } })
    handle = await startServer({ root, config })
    const before = readFileSync(join(root, 'laqi', 'api.json'), 'utf8')

    for (const path of ['/my orders', '/../evil']) {
      const res = await fetch(`http://127.0.0.1:${handle.port}/__laqi/api/endpoints`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'GET', path, default: 'ok', responses: { ok: { status: 200 } } }),
      })
      expect(res.status, path).not.toBe(201)
    }

    expect(readFileSync(join(root, 'laqi', 'api.json'), 'utf8')).toBe(before)
    // Y no aparece una banda de error: nunca se escribió nada roto.
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

    // Sin esto, recrear el endpoint más tarde lo revive sirviendo "boom".
    const state = (await (await get('/__laqi/api/state')).json()) as {
      overrides: Record<string, string>
    }
    expect(state.overrides).toEqual({})
  })
})

describe('the address the panel shows', () => {
  it('reports the port actually bound, not the configured one', async () => {
    // config.port es 0 en todos estos tests: el SO asigna el real. Antes el
    // panel mostraba "127.0.0.1:0" y el curl que ofrecía copiar fallaba.
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

    // Una pestaña del panel abierta: el stream de /events no termina solo.
    const res = await fetch(`http://127.0.0.1:${local.port}/__laqi/events`)
    res.body!.getReader().read().catch(() => {})
    await new Promise((r) => setTimeout(r, 100))

    const closed = local.close().then(() => 'closed' as const)
    const timeout = new Promise<'hung'>((r) => setTimeout(() => r('hung'), 3000))
    expect(await Promise.race([closed, timeout])).toBe('closed')
  })
})

describe('the panel is mounted on every loopback address', () => {
  it('mounts on ::1, not only 127.0.0.1 and localhost', async () => {
    // `--host ::1` es loopback: no expone nada a la red. Dejarlo afuera
    // apagaba el panel en silencio y parecía que estaba roto.
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

    // Un puerto libre y CONOCIDO para el listener principal: si el arranque
    // fallido lo deja abierto, el segundo intento choca contra sí mismo.
    const probe = await startServer({ root, config: ConfigSchema.parse({ port: 0 }) })
    const mainPort = probe.port
    await probe.close()

    // Y un puerto ocupado para que falle el listener del túnel.
    const blocker = await startServer({ root, config: ConfigSchema.parse({ port: 0 }) })

    try {
      await expect(
        startServer({
          root,
          config: ConfigSchema.parse({ port: mainPort }),
          share: { port: blocker.port, token: null, origins: [] },
        }),
      ).rejects.toThrow()

      // Si el principal quedó colgado, este arranque tira EADDRINUSE. El
      // proceso real, además, nunca terminaría: el listener huérfano
      // mantiene vivo el event loop después de decir que falló.
      handle = await startServer({ root, config: ConfigSchema.parse({ port: mainPort }) })
      expect((await fetch(`http://127.0.0.1:${mainPort}/x`)).status).toBe(200)
    } finally {
      await blocker.close()
    }
  })
})
