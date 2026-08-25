// apps/cli/src/serve.test.ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ConfigSchema } from '@laqi/schema'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { startServer, type ServeHandle } from './serve'

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

    // La ruta de creación en sí no valida el prefijo reservado (eso lo hace
    // parseEndpointKey al CARGAR, Plan 1) — pero el archivo sí queda escrito,
    // y la recarga inmediata debe reportar el error de LOAD FAILED en vez
    // de registrar el endpoint.
    expect(post.status).toBe(201)
    const status = await (await get('/__laqi/api/status')).json()
    expect((status as { errors: unknown[] }).errors.length).toBeGreaterThan(0)
    expect((await get('/__laqi/panel')).status).not.toBe(200)
  })
})
