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
})
