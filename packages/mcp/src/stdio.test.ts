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

function readApiFile(): Record<
  string,
  { default: string; responses: Record<string, { body?: unknown }> }
> {
  return JSON.parse(readFileSync(join(root, 'laqi', 'api.json'), 'utf8')) as ReturnType<
    typeof readApiFile
  >
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

  // The real server, started the way an agent would start it.
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
      'apply_generated_body',
      'create_endpoint',
      'delete_endpoint',
      'generate_data',
      'get_state',
      'get_types',
      'import_openapi',
      'list_endpoints',
      'refresh_schema',
      'regenerate_response',
      'reset_state',
      'scaffold_responses',
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

    const file = JSON.parse(readFileSync(join(root, 'laqi', 'api.json'), 'utf8')) as Record<
      string,
      unknown
    >
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

    // And the user's file stays byte for byte as it was.
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

    expect(result.json()).toMatchObject({
      created: ['GET /products/:sku'],
      updated: [],
      skipped: [],
    })

    const listed = (await call('list_endpoints')).json() as { endpoints: { id: string }[] }
    expect(listed.endpoints.map((e) => e.id)).toContain('GET /products/:sku')
  })

  it('skips an already-existing endpoint on import rather than clobbering it', async () => {
    const document = {
      paths: { '/users': { get: { responses: { '200': {} } } } },
    }
    const result = await call('import_openapi', { document })
    expect(result.json()).toMatchObject({ created: [], skipped: [{ where: 'GET /users' }] })

    // The original is left intact.
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

  it('generate_data with from: regenerates from the response schema', async () => {
    writeMocks({
      'GET /users': {
        default: 'ok',
        responses: {
          ok: {
            status: 200,
            body: [{ id: 1, name: 'Ada' }],
            schema: {
              name: 'User',
              source: { kind: 'typescript-paste' },
              diagnostics: [],
              document: {
                $schema: 'https://json-schema.org/draft/2020-12/schema',
                type: 'array',
                items: {
                  type: 'object',
                  properties: { id: { type: 'integer' }, name: { type: 'string' } },
                  required: ['id', 'name'],
                  additionalProperties: false,
                },
              },
            },
          },
        },
      },
    })

    const result = await call('generate_data', {
      from: { endpointId: 'GET /users', response: 'ok' },
      seed: 7,
    })
    expect(result.isError).toBe(false)
    expect(result.text).toMatch(/"seed": ?7/)
  }, 30_000)

  // An agent cannot open the file to see that the shape it got back is a
  // guess. Refusing is the only way to tell it.
  it('generate_data refuses a from: response with no schema, and says why', async () => {
    const result = await call('generate_data', {
      from: { endpointId: 'GET /users', response: 'ok' },
    })
    expect(result.isError).toBe(true)
    expect(result.text).toMatch(/no schema/i)
    expect(result.text).toMatch(/literal unions/i)
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

  it('generate_data reports a from: schema nested past the budget as a tool error, not a crash', async () => {
    let document: Record<string, unknown> = { type: 'string' }
    for (let i = 0; i < 2_000; i++) document = { type: 'array', items: document }
    writeMocks({
      'GET /deep': {
        default: 'ok',
        responses: {
          ok: {
            status: 200,
            body: null,
            schema: {
              name: 'Deep',
              source: { kind: 'typescript-paste' },
              diagnostics: [],
              document: { $schema: 'https://json-schema.org/draft/2020-12/schema', ...document },
            },
          },
        },
      },
    })

    const result = await call('generate_data', {
      from: { endpointId: 'GET /deep', response: 'ok' },
    })
    expect(result.isError).toBe(true)
    expect(result.text).toMatch(/nests deeper|depth/i)
  }, 30_000)

  it('advertises the model size limit in the generate_data schema, so an agent knows it before sending', async () => {
    const { tools } = await client.listTools()
    const generateData = tools.find((t) => t.name === 'generate_data')!
    const model = (generateData.inputSchema.properties as Record<string, { maxLength?: number }>)
      .model

    expect(model?.maxLength).toBe(200_000)
  }, 30_000)

  it('generate_data rejects an oversized model at the tool boundary', async () => {
    const result = await call('generate_data', {
      model: `export interface Big {\n${'  a: string\n'.repeat(60_000)}}`,
    })
    expect(result.isError).toBe(true)
    expect(result.text).toMatch(/200000|too_big|characters/i)
  }, 30_000)

  it('generate_data rejects broken TypeScript instead of mocking a recovered AST', async () => {
    const result = await call('generate_data', {
      model: 'export interface User { name: string',
    })
    expect(result.isError).toBe(true)
    expect(result.text).toMatch(/syntax/i)
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

  it('scaffold_responses adds the family the endpoint is missing', async () => {
    // GET /users is a collection: it gets an `empty`, never a `not-found`.
    const result = await call('scaffold_responses', { id: 'GET /users' })
    expect(result.isError).toBeFalsy()
    expect(result.text).toContain('empty')

    const file = readApiFile()
    expect(Object.keys(file['GET /users']!.responses)).toEqual(['ok', 'boom', 'empty', 'error'])
  }, 30_000)

  it('scaffold_responses keeps the bodies that were already there', async () => {
    await call('scaffold_responses', { id: 'GET /users' })
    const file = readApiFile()
    expect(file['GET /users']!.responses.ok!.body).toEqual([{ id: 1, name: 'Ada' }])
  }, 30_000)

  it('scaffold_responses says so rather than rewriting when nothing is missing', async () => {
    await call('scaffold_responses', { id: 'GET /users' })
    const second = await call('scaffold_responses', { id: 'GET /users' })
    expect(second.isError).toBeFalsy()
    expect(second.text).toMatch(/already has/i)
  }, 30_000)

  it('scaffold_responses reports an unknown endpoint cleanly', async () => {
    const result = await call('scaffold_responses', { id: 'GET /nope' })
    expect(result.isError).toBe(true)
    expect(result.text).not.toContain('FiberFailure')
  }, 30_000)
})

describe('regenerating and applying a body over stdio', () => {
  const TODO = 'export interface Todo { id: number; title: string; kind: "task" | "note" }'

  /** Puts a generated body and its schema on GET /users, through the tools. */
  async function seed(): Promise<{ revision: string }> {
    const generated = await call('generate_data', { model: TODO, seed: 42 })
    const { preview, schema, generation } = generated.json() as Record<string, unknown>

    const updated = await call('update_endpoint', {
      id: 'GET /users',
      default: 'ok',
      responses: { ok: { status: 200, body: preview, schema, generation } },
    })
    expect(updated.isError).toBe(false)

    const regenerated = await call('regenerate_response', { endpointId: 'GET /users' })
    return regenerated.json() as { revision: string }
  }

  it('regenerates from the stored schema without writing', async () => {
    const before = readApiFile()['GET /users']?.responses['ok']?.body
    await seed()

    const result = await call('regenerate_response', { endpointId: 'GET /users', seed: 9 })

    expect(result.isError).toBe(false)
    const { preview, revision } = result.json() as { preview: unknown; revision: string }
    expect(revision).toMatch(/^[0-9a-f]{64}$/)
    expect(preview).not.toEqual(before)
    // The file still holds what seed() wrote, not the new preview.
    expect(readApiFile()['GET /users']?.responses['ok']?.body).not.toEqual(preview)
  }, 60_000)

  it('refuses a response with no schema instead of inferring one', async () => {
    const result = await call('regenerate_response', { endpointId: 'GET /users' })

    expect(result.isError).toBe(true)
    expect(result.text).toContain('no schema')
  }, 30_000)

  it('applies a generated body and serves it from the file', async () => {
    const { revision } = await seed()
    const next = await call('regenerate_response', { endpointId: 'GET /users', seed: 9 })
    const { preview, generation } = next.json() as Record<string, unknown>

    const applied = await call('apply_generated_body', {
      endpointId: 'GET /users',
      body: preview,
      generation,
      revision,
    })

    expect(applied.isError).toBe(false)
    expect(readApiFile()['GET /users']?.responses['ok']?.body).toEqual(preview)
  }, 60_000)

  it('returns the conflict and the current revision when the body is not laqi’s', async () => {
    const regenerated = await call('generate_data', { model: TODO, seed: 42 })
    const { preview, schema, generation } = regenerated.json() as Record<string, unknown>
    // A schema, but a body nobody generated: the ordinary hand-written case.
    await call('update_endpoint', {
      id: 'GET /users',
      default: 'ok',
      responses: { ok: { status: 200, body: [{ id: 1, name: 'Ada' }], schema } },
    })
    const current = await call('regenerate_response', { endpointId: 'GET /users' })
    const { revision } = current.json() as { revision: string }

    const refused = await call('apply_generated_body', {
      endpointId: 'GET /users',
      body: preview,
      generation,
      revision,
    })

    expect(refused.isError).toBe(true)
    const conflict = refused.json() as { conflict: string; revision: string }
    expect(conflict.conflict).toBe('body-unverified')
    expect(conflict.revision).toBe(revision)
    expect(readApiFile()['GET /users']?.responses['ok']?.body).toEqual([{ id: 1, name: 'Ada' }])

    const confirmed = await call('apply_generated_body', {
      endpointId: 'GET /users',
      body: preview,
      generation,
      revision: conflict.revision,
      confirm: true,
    })

    expect(confirmed.isError).toBe(false)
    expect(readApiFile()['GET /users']?.responses['ok']?.body).toEqual(preview)
  }, 60_000)

  it('refuses a stale revision even with confirm', async () => {
    const { revision } = await seed()
    const next = await call('regenerate_response', { endpointId: 'GET /users', seed: 9 })
    const { preview, generation } = next.json() as Record<string, unknown>
    await call('apply_generated_body', {
      endpointId: 'GET /users',
      body: preview,
      generation,
      revision,
    })

    const refused = await call('apply_generated_body', {
      endpointId: 'GET /users',
      body: preview,
      generation,
      revision,
      confirm: true,
    })

    expect(refused.isError).toBe(true)
    expect((refused.json() as { conflict: string }).conflict).toBe('stale-revision')
  }, 60_000)

  it('refuses to refresh a schema that came from a paste, and writes nothing', async () => {
    const { revision } = await seed()
    const before = readApiFile()['GET /users']?.responses['ok']

    const result = await call('refresh_schema', { endpointId: 'GET /users', revision })

    expect(result.isError).toBe(true)
    expect(result.text).toContain('paste it again')
    expect(readApiFile()['GET /users']?.responses['ok']).toEqual(before)
  }, 60_000)
})

describe('the strict loss policy over stdio', () => {
  // A function-valued property cannot be represented in JSON Schema. The
  // import refuses, names it, and writes nothing.
  const LOSSY = 'export interface Job { id: number; run: () => void }'

  it('refuses a lossy import and names what would be lost', async () => {
    const result = await call('generate_data', { model: LOSSY })

    expect(result.isError).toBe(true)
    expect(result.text.toLowerCase()).toContain('lose')
  }, 30_000)

  it('imports the same model once the loss is acknowledged', async () => {
    const result = await call('generate_data', { model: LOSSY, allowLoss: true, seed: 1 })

    expect(result.isError).toBe(false)
    const { diagnostics } = result.json() as { diagnostics: { code: string }[] }
    expect(diagnostics.some((item) => item.code.startsWith('loss.'))).toBe(true)
  }, 30_000)

  it('imports a JSON Schema document handed straight to source', async () => {
    const result = await call('generate_data', {
      source: {
        kind: 'json-schema',
        document: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] },
        name: 'Todo',
      },
      seed: 3,
    })

    expect(result.isError).toBe(false)
    const { preview } = result.json() as { preview: Record<string, unknown> }
    expect(typeof preview['id']).toBe('number')
  }, 30_000)

  it('names the known kinds when no adapter serves the one asked for', async () => {
    const result = await call('generate_data', { source: { kind: 'protobuf', document: {} } })

    expect(result.isError).toBe(true)
  }, 30_000)
})
