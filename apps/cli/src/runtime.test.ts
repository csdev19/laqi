import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ConfigSchema } from '@laqi/schema'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildRuntime } from './runtime'

// Everything the server answers with comes from here: the route table, the
// scenarios, and — the part that matters most — the errors. A mock file the
// loader rejected and a route the table rejected are different failures
// from different modules, and the panel shows one list. If either side is
// dropped here, laqi starts up looking healthy while serving less than the
// developer wrote.

let root: string
const config = (overrides: Record<string, unknown> = {}) => ConfigSchema.parse(overrides)

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'laqi-runtime-'))
  mkdirSync(join(root, 'laqi'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function writeMocks(contents: unknown, file = 'api.json'): void {
  writeFileSync(join(root, 'laqi', file), JSON.stringify(contents), 'utf8')
}

const todos = {
  'GET /todos': {
    default: 'ok',
    responses: { ok: { status: 200, body: [] }, error: { status: 500 } },
  },
}

describe('buildRuntime', () => {
  it('builds a route table from the mocks folder', () => {
    writeMocks(todos)

    const runtime = buildRuntime(root, config())

    expect(runtime.errors).toEqual([])
    expect(runtime.source).toBeTruthy()
    expect(runtime.table).toBeTruthy()
  })

  it('carries the scenarios through', () => {
    writeMocks(todos)
    writeMocks({ offline: { 'GET /todos': 'error' } }, 'scenarios.json')

    expect(buildRuntime(root, config()).scenarios).toEqual({
      offline: { 'GET /todos': 'error' },
    })
  })

  it('reports a file the loader could not read', () => {
    writeMocks(todos)
    writeFileSync(join(root, 'laqi', 'broken.json'), '{ nope', 'utf8')

    const runtime = buildRuntime(root, config())

    expect(runtime.errors).toHaveLength(1)
    expect(runtime.errors[0]?.file).toContain('broken.json')
  })

  // The two error sources are merged on purpose: the panel renders one list,
  // and a route conflict is exactly as fatal to a request as a parse error.
  it('merges loader errors with route-table errors', () => {
    writeMocks(todos)
    // The same route in a second file: the loader reads both happily, and
    // the route table is where it becomes a conflict.
    writeMocks(todos, 'again.json')
    writeFileSync(join(root, 'laqi', 'broken.json'), '{ nope', 'utf8')

    const messages = buildRuntime(root, config()).errors.map((error) => error.message)

    expect(messages.some((message) => message.includes('duplicate route'))).toBe(true)
    expect(messages).toHaveLength(2)
  })

  it('honours a custom mocks folder', () => {
    mkdirSync(join(root, 'mocks'))
    writeFileSync(join(root, 'mocks', 'api.json'), JSON.stringify(todos), 'utf8')

    const runtime = buildRuntime(root, config({ dir: 'mocks' }))

    expect(runtime.errors).toEqual([])
    expect(runtime.table).toBeTruthy()
  })
})
