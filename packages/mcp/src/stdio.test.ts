import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const CLI = join(import.meta.dirname, '..', '..', '..', 'apps', 'cli', 'src', 'index.ts')

let root: string
let client: Client
let transport: StdioClientTransport

function writeMocks(contents: unknown, file = 'laqi/api.json') {
  const full = join(root, file)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, JSON.stringify(contents, null, 2), 'utf8')
}

async function call(name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args })
  const content = result.content as { type: string; text: string }[]
  return {
    isError: result.isError === true,
    text: content.map((c) => c.text).join('\n'),
    json: () => JSON.parse(content[0]!.text) as unknown,
  }
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'laqi-stdio-'))
  writeMocks({
    'GET /users': {
      default: 'ok',
      responses: {
        ok: { status: 200, body: [{ id: 1, name: 'Ada' }] },
        boom: { status: 500 },
      },
    },
  })
  writeMocks({ offline: { 'GET /users': 'boom' } }, 'laqi/scenarios.json')

  // El servidor real, arrancado como lo arrancaría un agente.
  transport = new StdioClientTransport({ command: 'bun', args: [CLI, 'mcp'], cwd: root })
  client = new Client({ name: 'test', version: '1.0.0' })
  await client.connect(transport)
}, 30_000)

afterEach(async () => {
  await client?.close().catch(() => {})
  rmSync(root, { recursive: true, force: true })
})

describe('laqi mcp over stdio', () => {
  it('advertises every tool the ADR promises', async () => {
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name).sort()).toEqual([
      'create_endpoint',
      'delete_endpoint',
      'generate_data',
      'get_state',
      'get_types',
      'import_openapi',
      'list_endpoints',
      'reset_state',
      'set_response',
      'set_scenario',
      'update_endpoint',
    ])
  })

  it('teaches the layer model in its instructions, so the agent does not guess', async () => {
    const instructions = client.getInstructions() ?? ''
    expect(instructions).toContain('An override beats the active scenario')
    expect(instructions).toContain('METHOD /path')
  })

  it('lists endpoints with what is live', async () => {
    const result = await call('list_endpoints')
    expect(result.isError).toBe(false)
    const { endpoints } = result.json() as { endpoints: { id: string; live: unknown }[] }
    expect(endpoints[0]).toMatchObject({ id: 'GET /users', live: { name: 'ok', layer: 'default' } })
  })

  it('flips a response and the change lands on disk', async () => {
    const result = await call('set_response', { id: 'GET /users', response: 'boom' })
    expect(result.isError).toBe(false)
    expect(result.json()).toMatchObject({ live: { name: 'boom', layer: 'state' } })

    const state = JSON.parse(readFileSync(join(root, '.laqi', 'state.json'), 'utf8')) as {
      overrides: Record<string, string>
    }
    expect(state.overrides).toEqual({ 'GET /users': 'boom' })
  })

  it('returns a readable error, not a crash, for an undeclared response', async () => {
    const result = await call('set_response', { id: 'GET /users', response: 'ghost' })
    expect(result.isError).toBe(true)
    expect(result.text).toContain('not declared')
    expect(result.text).toContain('ok, boom')
  })

  it('activates a scenario and says what moved', async () => {
    const result = await call('set_scenario', { name: 'offline' })
    expect(result.json()).toMatchObject({
      scenario: 'offline',
      moved: [{ id: 'GET /users', live: { name: 'boom', layer: 'scenario' } }],
    })
  })

  it('creates an endpoint that the mock files then contain', async () => {
    const result = await call('create_endpoint', {
      method: 'POST',
      path: '/orders',
      default: 'created',
      responses: { created: { status: 201, body: { id: 1 } } },
    })
    expect(result.isError).toBe(false)

    const file = JSON.parse(readFileSync(join(root, 'laqi', 'api.json'), 'utf8')) as Record<string, unknown>
    expect(file).toHaveProperty(['POST /orders'])
  })

  it('rejects an invalid definition through the schema, with the reason', async () => {
    const result = await call('create_endpoint', {
      method: 'POST',
      path: '/bad',
      default: 'nope',
      responses: { created: { status: 201 } },
    })
    expect(result.isError).toBe(true)
    expect(result.text.length).toBeGreaterThan(0)
  })

  it('refuses a crafted path instead of writing an endpoint that can never load', async () => {
    const before = readFileSync(join(root, 'laqi', 'api.json'), 'utf8')

    for (const path of ['/../../escaped', '/__laqi/steal']) {
      const result = await call('create_endpoint', {
        method: 'GET',
        path,
        default: 'ok',
        responses: { ok: { status: 200 } },
      })
      expect(result.isError).toBe(true)
    }

    // Y el archivo del usuario queda byte por byte como estaba.
    expect(readFileSync(join(root, 'laqi', 'api.json'), 'utf8')).toBe(before)
  })

  it('imports an OpenAPI document into real endpoints', async () => {
    const result = await call('import_openapi', {
      document: {
        openapi: '3.0.0',
        paths: {
          '/products/{sku}': {
            get: {
              summary: 'One product',
              responses: {
                '200': {
                  content: {
                    'application/json': {
                      schema: { type: 'object', properties: { sku: { type: 'string' } } },
                    },
                  },
                },
                '404': {},
              },
            },
          },
        },
      },
    })

    expect(result.json()).toMatchObject({ created: ['GET /products/:sku'], updated: [], skipped: [] })

    const listed = (await call('list_endpoints')).json() as { endpoints: { id: string }[] }
    expect(listed.endpoints.map((e) => e.id)).toContain('GET /products/:sku')
  })

  it('skips an already-existing endpoint on import rather than clobbering it', async () => {
    const document = {
      paths: { '/users': { get: { responses: { '200': {} } } } },
    }
    const result = await call('import_openapi', { document })
    expect(result.json()).toMatchObject({ created: [], skipped: [{ where: 'GET /users' }] })

    // El original sigue intacto.
    const file = JSON.parse(readFileSync(join(root, 'laqi', 'api.json'), 'utf8')) as Record<
      string,
      { responses: Record<string, unknown> }
    >
    expect(Object.keys(file['GET /users']!.responses)).toEqual(['ok', 'boom'])
  })

  it('replaces it when overwrite is asked for explicitly', async () => {
    const result = await call('import_openapi', {
      document: { paths: { '/users': { get: { responses: { '200': {} } } } } },
      overwrite: true,
    })
    expect(result.json()).toMatchObject({ updated: ['GET /users'] })
  })

  it('deletes an endpoint and drops its override', async () => {
    await call('set_response', { id: 'GET /users', response: 'boom' })
    expect((await call('delete_endpoint', { id: 'GET /users' })).isError).toBe(false)

    const state = (await call('get_state')).json() as { overrides: Record<string, string> }
    expect(state.overrides).toEqual({})
  })

  it('resets everything back to file defaults', async () => {
    await call('set_response', { id: 'GET /users', response: 'boom' })
    await call('set_scenario', { name: 'offline' })

    expect((await call('reset_state')).json()).toEqual({ cleared: 2 })
    expect((await call('get_state')).json()).toMatchObject({ scenario: null, overrides: {} })
  })

  it('get_types derives a TypeScript interface from the live data', async () => {
    const result = await call('get_types', { endpointId: 'GET /users' })
    expect(result.isError).toBe(false)
    expect(result.text).toContain('interface')
  }, 30_000)

  it('generate_data returns a preview and never writes anything', async () => {
    const before = readFileSync(join(root, 'laqi', 'api.json'), 'utf8')
    const result = await call('generate_data', {
      model: 'export interface Todo { id: number; title: string }',
      seed: 42,
    })
    expect(result.isError).toBe(false)
    const { preview } = result.json() as { preview: Record<string, unknown> }
    expect(typeof preview.id).toBe('number')
    // Pure tool: the mock file is byte-identical afterwards.
    expect(readFileSync(join(root, 'laqi', 'api.json'), 'utf8')).toBe(before)
  }, 30_000)

  it('generate_data with from: regenerates from an existing response', async () => {
    const result = await call('generate_data', {
      from: { endpointId: 'GET /users', response: 'ok' }, seed: 7,
    })
    expect(result.isError).toBe(false)
  }, 30_000)

  // Finding 5 (MCP twin): generate_data had no try/catch around its calls
  // into @laqi/generate, unlike get_types right above it — a failure there
  // escaped as an unhandled rejection instead of a clean tool error.

  it('generate_data reports a genuine generation failure as a tool error, not a crash', async () => {
    // string[][][][] at arrayLength 50 (the tool's max) blows the
    // generation budget (50^4 = 6,250,000 leaf values) — reachable through
    // the public tool.
    const result = await call('generate_data', {
      model: 'export interface Big { a: string[][][][] }',
      arrayLength: 50,
    })
    expect(result.isError).toBe(true)
    expect(result.text).toMatch(/more than 100000 values/)
  }, 30_000)

  it('generate_data reports pathologically nested from: data as a tool error, not a crash', async () => {
    let deep: unknown = 'leaf'
    for (let i = 0; i < 2_000; i++) deep = { child: deep }
    writeMocks({
      'GET /deep': { default: 'ok', responses: { ok: { status: 200, body: deep } } },
    })

    const result = await call('generate_data', { from: { endpointId: 'GET /deep', response: 'ok' } })
    expect(result.isError).toBe(true)
    expect(result.text).toMatch(/nesting|depth/i)
  }, 30_000)

  // Finding 9 (Low): get_types leaked Effect's FiberFailure wrapper into
  // user-visible text — the equivalent HTTP route already reads clean
  // through error.message.

  it('get_types reports an unknown language cleanly, without the Effect wrapper', async () => {
    const result = await call('get_types', { endpointId: 'GET /users', lang: 'not-a-real-lang' })
    expect(result.isError).toBe(true)
    expect(result.text).toContain('unknown language')
    expect(result.text).not.toContain('FiberFailure')
  }, 30_000)
})
