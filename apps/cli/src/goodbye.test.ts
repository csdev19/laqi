// apps/cli/src/goodbye.test.ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionCounters } from '@laqi/core'
import { ConfigSchema } from '@laqi/schema'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { renderGoodbye } from './goodbye'
import { startServer, type ServeHandle } from './serve'

describe('renderGoodbye', () => {
  it('carries a known mix of counted numbers into the rendered summary', () => {
    const counters = new SessionCounters()
    counters.recordRequest(true)
    counters.recordRequest(false)
    counters.recordRequest(true)
    counters.recordFlip()
    counters.recordWrite('laqi/api.json')
    counters.recordWrite('laqi/api.json')

    const out = renderGoodbye(counters, 41 * 60_000, 'none', false, 72)

    expect(out).toContain('up 41m')
    expect(out).toContain('3 requests · 1 unmatched')
    // toContain('1 time') would also pass on '1 times' — this counts flips,
    // which is singular here, and the plural is exercised by 'written 2
    // times' three lines down.
    expect(out).toMatch(/\b1 time\b/)
    expect(out).toContain('laqi/api.json')
    expect(out).toContain('written 2 times')
  })

  it('carries the farewell when sharing was never on', () => {
    const out = renderGoodbye(new SessionCounters(), 1_000, 'none', false, 72)
    expect(out).toContain('tupananchikkama — until we meet again')
  })

  // Closing the tunnel is the fact that matters at that moment, not the
  // farewell — the last line swaps for it instead of adding a second one.
  it('reads "public URL closed" instead of the farewell when sharing was on', () => {
    const out = renderGoodbye(new SessionCounters(), 1_000, 'none', true, 72)
    expect(out).toContain('public URL closed')
    expect(out).not.toContain('tupananchikkama')
  })
})

let root: string
let handle: ServeHandle | undefined

const config = ConfigSchema.parse({ port: 0, host: '127.0.0.1' })

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'laqi-goodbye-'))
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

describe('the counters a real session drives', () => {
  it('counts every request, and a route that matches nothing as unmatched — the number the whole screen exists for', async () => {
    writeMocks({ 'GET /users': { default: 'ok', responses: { ok: { status: 200, body: [] } } } })
    const counters = new SessionCounters()
    handle = await startServer({ root, config, counters })

    await fetch(`http://127.0.0.1:${handle.port}/users`)
    await fetch(`http://127.0.0.1:${handle.port}/this-route-does-not-exist`)

    const snapshot = counters.snapshot()
    expect(snapshot.requests).toBe(2)
    expect(snapshot.unmatched).toBe(1)
  })

  it('counts a response override written through the control plane as a flip', async () => {
    writeMocks({
      'GET /users': {
        default: 'ok',
        responses: { ok: { status: 200, body: [] }, boom: { status: 500, body: {} } },
      },
    })
    const counters = new SessionCounters()
    handle = await startServer({ root, config, counters })

    await fetch(`http://127.0.0.1:${handle.port}/__laqi/api/state`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scenario: null, overrides: { 'GET /users': 'boom' } }),
    })

    expect(counters.snapshot().flips).toBe(1)
  })

  it('records the file a new endpoint was written to', async () => {
    const counters = new SessionCounters()
    handle = await startServer({ root, config, counters })

    await fetch(`http://127.0.0.1:${handle.port}/__laqi/api/endpoints`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        method: 'GET',
        path: '/orders',
        default: 'ok',
        responses: { ok: { status: 200, body: [] } },
      }),
    })

    expect(counters.snapshot().filesWritten).toEqual([{ file: join('laqi', 'api.json'), times: 1 }])
  })
})
