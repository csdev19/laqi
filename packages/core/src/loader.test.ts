import { mkdtempSync, mkdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadMocks } from './loader'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'laqi-loader-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function writeMock(relative: string, contents: string) {
  const full = join(root, relative)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, contents, 'utf8')
}

const usersEndpoint = JSON.stringify({
  'GET /users': { default: 'ok', responses: { ok: { status: 200, body: [] } } },
})

const load = () => loadMocks({ root, dir: 'laqi', file: 'laqi.json' })

describe('loadMocks', () => {
  it('returns nothing and no error for a fresh project', () => {
    const result = load()
    expect(result.endpoints).toEqual([])
    expect(result.errors).toEqual([])
    expect(result.source).toBe('none')
  })

  it('loads the single-file mode', () => {
    writeMock('laqi.json', usersEndpoint)
    const result = load()
    expect(result.source).toBe('file')
    expect(result.endpoints).toHaveLength(1)
    expect(result.endpoints[0]?.id).toBe('GET /users')
    expect(result.endpoints[0]?.method).toBe('GET')
    expect(result.endpoints[0]?.path).toBe('/users')
  })

  it('prefers the folder when both exist', () => {
    writeMock('laqi.json', usersEndpoint)
    writeMock('laqi/api.json', usersEndpoint)
    expect(load().source).toBe('dir')
  })

  it('loads several files from the folder', () => {
    writeMock('laqi/api.json', usersEndpoint)
    writeMock(
      'laqi/orders.json',
      JSON.stringify({
        'GET /orders': { default: 'ok', responses: { ok: { status: 200, body: [] } } },
      }),
    )
    const ids = load()
      .endpoints.map((e) => e.id)
      .sort()
    expect(ids).toEqual(['GET /orders', 'GET /users'])
  })

  it('recurses into subfolders', () => {
    writeMock('laqi/v1/api.json', usersEndpoint)
    expect(load().endpoints).toHaveLength(1)
  })

  it('ignores dotfiles', () => {
    writeMock('laqi/.state.json', '{ this is not json }')
    const result = load()
    expect(result.errors).toEqual([])
    expect(result.endpoints).toEqual([])
  })

  it('reads scenarios.json as scenarios, not as endpoints', () => {
    writeMock('laqi/api.json', usersEndpoint)
    writeMock(
      'laqi/scenarios.json',
      JSON.stringify({ 'checkout-broken': { 'GET /users': 'boom' } }),
    )
    const result = load()
    expect(result.endpoints).toHaveLength(1)
    expect(result.scenarios['checkout-broken']).toEqual({ 'GET /users': 'boom' })
  })

  it('does not treat a file merely ending in "scenarios.json" as the scenarios file', () => {
    writeMock('laqi/user-scenarios.json', usersEndpoint)
    const result = load()
    expect(result.endpoints.map((e) => e.id)).toEqual(['GET /users'])
    expect(result.errors).toEqual([])
  })

  it('keeps serving other files when one has broken JSON (H3)', () => {
    writeMock('laqi/api.json', usersEndpoint)
    writeMock('laqi/orders.json', '{\n  "GET /orders": {},\n}\n')

    const result = load()
    expect(result.endpoints.map((e) => e.id)).toEqual(['GET /users'])
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]?.file).toContain('orders.json')
    expect(result.errors[0]?.line).toBe(3)
    expect(result.errors[0]?.excerpt).toContain('^')
  })

  it('drops only the offending endpoint on a semantic error (H5)', () => {
    writeMock(
      'laqi/api.json',
      JSON.stringify({
        'GET /users': { default: 'ok', responses: { ok: { status: 200, body: [] } } },
        'GET /broken': { default: 'nope', responses: { ok: { status: 200 } } },
      }),
    )

    const result = load()
    expect(result.endpoints.map((e) => e.id)).toEqual(['GET /users'])
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]?.message).toContain('nope')
  })

  it('reports an unparseable endpoint key', () => {
    writeMock(
      'laqi/api.json',
      JSON.stringify({ '(get)files/:id': { default: 'ok', responses: { ok: { status: 200 } } } }),
    )
    const result = load()
    expect(result.endpoints).toEqual([])
    expect(result.errors[0]?.message).toContain('METHOD /path')
  })

  it('records the line of each endpoint key', () => {
    writeMock(
      'laqi/api.json',
      '{\n  "GET /users": {\n    "default": "ok",\n    "responses": { "ok": { "status": 200 } }\n  }\n}\n',
    )
    expect(load().endpoints[0]?.line).toBe(2)
  })

  it('reports a per-file error instead of throwing when a file goes unreadable between scan and read (C2)', () => {
    // A symlink whose target gets deleted right before reading it: readdirSync
    // lists it, but readFileSync blows up — the same gap as a file deleted
    // mid-load.
    writeMock('laqi/api.json', usersEndpoint)
    const target = join(root, 'ghost-target.json')
    writeFileSync(target, usersEndpoint, 'utf8')
    symlinkSync(target, join(root, 'laqi', 'ghost.json'))
    unlinkSync(target)

    const result = load()
    expect(result.endpoints.map((e) => e.id)).toEqual(['GET /users'])
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]?.file).toContain('ghost.json')
    expect(result.errors[0]?.message).toContain('could not read file')
  })

  it('preserves file order', () => {
    writeMock(
      'laqi/api.json',
      JSON.stringify({
        'POST /users': { default: 'ok', responses: { ok: { status: 201 } } },
        'GET /users': { default: 'ok', responses: { ok: { status: 200 } } },
      }),
    )
    expect(load().endpoints.map((e) => e.id)).toEqual(['POST /users', 'GET /users'])
  })
})
