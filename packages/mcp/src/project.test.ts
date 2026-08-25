import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ConfigSchema } from '@laqi/schema'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Project } from './project'

let root: string
let project: Project

const config = ConfigSchema.parse({})

function writeMocks(contents: unknown, file = 'laqi/api.json') {
  const full = join(root, file)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, JSON.stringify(contents, null, 2), 'utf8')
}

function readMocks(file = 'laqi/api.json'): Record<string, unknown> {
  return JSON.parse(readFileSync(join(root, file), 'utf8')) as Record<string, unknown>
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'laqi-mcp-'))
  writeMocks({
    'GET /users': {
      description: 'the people',
      default: 'ok',
      responses: { ok: { status: 200, body: [] }, boom: { status: 500 } },
    },
    'POST /orders': {
      default: 'created',
      responses: { created: { status: 201 }, error: { status: 500 } },
    },
  })
  writeMocks({ offline: { 'GET /users': 'boom' } }, 'laqi/scenarios.json')
  project = new Project(root, config)
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function unwrap<T>(result: { ok: true; value: T } | { ok: false; error: string }): T {
  if (!result.ok) throw new Error(`expected ok, got: ${result.error}`)
  return result.value
}

describe('listEndpoints', () => {
  it('lists every endpoint with its responses and what is live', () => {
    const { endpoints } = unwrap(project.listEndpoints())
    expect(endpoints).toHaveLength(2)

    const users = endpoints.find((e) => e.id === 'GET /users')!
    expect(users.method).toBe('GET')
    expect(users.description).toBe('the people')
    expect(users.responses.map((r) => r.name)).toEqual(['ok', 'boom'])
    expect(users.live).toEqual({ name: 'ok', layer: 'default' })
  })

  it('surfaces load errors instead of pretending the file is fine', () => {
    writeFileSync(join(root, 'laqi', 'broken.json'), '{ nope', 'utf8')
    const { errors } = unwrap(project.listEndpoints())
    expect(errors.length).toBeGreaterThan(0)
  })
})

describe('setResponse', () => {
  it('writes an override and reports the new live layer', () => {
    const view = unwrap(project.setResponse('GET /users', 'boom'))
    expect(view.live).toEqual({ name: 'boom', layer: 'state' })
    expect(unwrap(project.getState()).overrides).toEqual({ 'GET /users': 'boom' })
  })

  it('clears the override with null and returns to the file default', () => {
    project.setResponse('GET /users', 'boom')
    const view = unwrap(project.setResponse('GET /users', null))
    expect(view.live).toEqual({ name: 'ok', layer: 'default' })
    expect(unwrap(project.getState()).overrides).toEqual({})
  })

  it('refuses a response the endpoint does not declare, and lists the real ones', () => {
    const result = project.setResponse('GET /users', 'ghost')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('not declared')
      expect(result.error).toContain('ok, boom')
    }
  })

  it('refuses an unknown endpoint and hints at the known ids', () => {
    const result = project.setResponse('GET /nope', 'ok')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('GET /users')
  })

  it('does not write state when it refuses', () => {
    project.setResponse('GET /users', 'ghost')
    expect(unwrap(project.getState()).overrides).toEqual({})
  })
})

describe('setScenario', () => {
  it('activates a scenario and reports what it moved', () => {
    const result = unwrap(project.setScenario('offline'))
    expect(result.scenario).toBe('offline')
    expect(result.moved.map((v) => v.id)).toEqual(['GET /users'])
    expect(result.moved[0]!.live).toEqual({ name: 'boom', layer: 'scenario' })
  })

  it('deactivates with null', () => {
    project.setScenario('offline')
    expect(unwrap(project.setScenario(null)).scenario).toBeNull()
    expect(unwrap(project.getState()).scenario).toBeNull()
  })

  it('refuses an unknown scenario and names the real ones', () => {
    const result = project.setScenario('nope')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('offline')
  })

  it('says so plainly when no scenarios are declared at all', () => {
    rmSync(join(root, 'laqi', 'scenarios.json'))
    const result = project.setScenario('nope')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('no scenarios are declared')
  })

  it('lets a per-endpoint override beat the active scenario', () => {
    project.setScenario('offline')
    const view = unwrap(project.setResponse('GET /users', 'ok'))
    expect(view.live).toEqual({ name: 'ok', layer: 'state' })
  })
})

describe('createEndpoint', () => {
  it('writes the endpoint to the mocks folder and serves it back', () => {
    const created = unwrap(
      project.createEndpoint({
        method: 'get',
        path: '/health',
        default: 'ok',
        responses: { ok: { status: 200, body: { up: true } } },
      }),
    )
    expect(created.id).toBe('GET /health')
    expect(readMocks()).toHaveProperty(['GET /health'])
    expect(unwrap(project.listEndpoints()).endpoints.map((e) => e.id)).toContain('GET /health')
  })

  it('refuses a duplicate id and names the file that already has it', () => {
    const result = project.createEndpoint({
      method: 'GET',
      path: '/users',
      default: 'ok',
      responses: { ok: { status: 200 } },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('laqi/api.json')
  })

  it('refuses a path without a leading slash', () => {
    const result = project.createEndpoint({
      method: 'GET',
      path: 'health',
      default: 'ok',
      responses: { ok: { status: 200 } },
    })
    expect(result.ok).toBe(false)
  })

  it('refuses an unknown method', () => {
    const result = project.createEndpoint({
      method: 'FETCH',
      path: '/health',
      default: 'ok',
      responses: { ok: { status: 200 } },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('unknown HTTP method')
  })

  it('refuses a default naming a response that does not exist', () => {
    const result = project.createEndpoint({
      method: 'GET',
      path: '/health',
      default: 'ghost',
      responses: { ok: { status: 200 } },
    })
    expect(result.ok).toBe(false)
  })
})

describe('updateEndpoint', () => {
  it('rewrites the definition in the file it came from', () => {
    unwrap(
      project.updateEndpoint('GET /users', {
        default: 'ok',
        responses: { ok: { status: 200, body: { changed: true } } },
      }),
    )
    expect(readMocks()['GET /users']).toEqual({
      default: 'ok',
      responses: { ok: { status: 200, body: { changed: true } } },
    })
  })

  it('refuses an unknown endpoint', () => {
    expect(
      project.updateEndpoint('GET /nope', { default: 'ok', responses: { ok: { status: 200 } } }).ok,
    ).toBe(false)
  })
})

describe('deleteEndpoint', () => {
  it('removes it from the file', () => {
    unwrap(project.deleteEndpoint('POST /orders'))
    expect(readMocks()).not.toHaveProperty(['POST /orders'])
  })

  it('drops a dangling override so state never names a deleted endpoint', () => {
    project.setResponse('POST /orders', 'error')
    unwrap(project.deleteEndpoint('POST /orders'))
    expect(unwrap(project.getState()).overrides).toEqual({})
  })

  it('leaves other endpoints and their overrides alone', () => {
    project.setResponse('GET /users', 'boom')
    unwrap(project.deleteEndpoint('POST /orders'))
    expect(unwrap(project.getState()).overrides).toEqual({ 'GET /users': 'boom' })
  })
})

describe('getState', () => {
  it('reports only what is off its default, not the whole table', () => {
    project.setResponse('GET /users', 'boom')
    const state = unwrap(project.getState())
    expect(state.active.map((v) => v.id)).toEqual(['GET /users'])
    expect(state.scenarios).toEqual(['offline'])
  })

  it('is empty on a clean project', () => {
    const state = unwrap(project.getState())
    expect(state).toMatchObject({ scenario: null, overrides: {}, active: [] })
  })
})

describe('resetState', () => {
  it('clears overrides and the scenario, and counts what it cleared', () => {
    project.setResponse('GET /users', 'boom')
    project.setScenario('offline')
    expect(unwrap(project.resetState()).cleared).toBe(2)
    expect(unwrap(project.getState())).toMatchObject({ scenario: null, overrides: {} })
  })
})

describe('createEndpoint — validation runs before the write', () => {
  it('refuses the reserved control-panel prefix', () => {
    const result = project.createEndpoint({
      method: 'GET',
      path: '/__laqi/steal',
      default: 'ok',
      responses: { ok: { status: 200 } },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('reserved')
  })

  it('refuses an unreachable .. path', () => {
    const result = project.createEndpoint({
      method: 'GET',
      path: '/../../escaped',
      default: 'ok',
      responses: { ok: { status: 200 } },
    })
    expect(result.ok).toBe(false)
  })

  it('leaves the mock file untouched when it refuses', () => {
    const before = readMocks()
    project.createEndpoint({
      method: 'GET',
      path: '/__laqi/steal',
      default: 'ok',
      responses: { ok: { status: 200 } },
    })
    project.createEndpoint({
      method: 'GET',
      path: '/../escaped',
      default: 'ok',
      responses: { ok: { status: 200 } },
    })
    expect(readMocks()).toEqual(before)
  })
})
