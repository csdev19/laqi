// apps/cli/src/serve.schema.test.ts
//
// The schema routes, end to end against a real listener. They are here and
// not in the server package because the conflict rules only mean anything
// with a real file underneath them: the whole point is what happens when the
// bytes on disk stop matching what the caller looked at.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ConfigSchema, type SchemaSnapshot } from '@laqi/schema'
import { beforeAll, describe, expect, vi } from 'vitest'
import { it, warmGenerationStack, type Lab } from './serve.fixture'

// Nearly every request here is CPU-bound generation work: a pasted model
// goes through the TypeScript compiler, a preview compiles a JSON Schema
// and generates a body. Idle, each is a few hundred milliseconds. On a
// loaded machine they scale with the load, and one test chains up to six
// of them: measured at 2 to 4 seconds per compiler call with three suites
// running alongside, which put the longest tests past the 20 second
// default. The budget below covers that chain at that load; the warm-up
// hook keeps the compiler's one-time import out of it.
vi.setConfig({ testTimeout: 60_000 })

beforeAll(warmGenerationStack)

const TODO = 'export interface Todo { id: number; title: string; done: boolean }'

const RESPONSE = `/api/endpoints/${encodeURIComponent('GET /todos')}/responses/ok`

/** Imports a model, previews a body, and writes both onto `GET /todos`. */
async function seedGeneratedResponse(lab: Lab): Promise<{ revision: string; body: unknown }> {
  lab.writeMocks({
    'GET /todos': { default: 'ok', responses: { ok: { status: 200, body: null } } },
  })
  const handle = await lab.start()

  const imported = await lab.send('/api/schema/import', 'POST', {
    source: { kind: 'typescript-paste', source: TODO },
  })
  const { snapshot } = (await imported.json()) as { snapshot: SchemaSnapshot }

  const previewed = await lab.send('/api/schema/preview', 'POST', { snapshot, seed: 42 })
  const preview = (await previewed.json()) as { body: unknown; evidence: unknown }

  // The seeded response has no evidence yet, so the first write confirms.
  const current = lab.readMocks()['GET /todos']?.responses['ok']
  lab.writeMocks({
    'GET /todos': {
      default: 'ok',
      responses: {
        ok: { ...current, body: preview.body, generation: preview.evidence, schema: snapshot },
      },
    },
  })
  handle.reload()

  const regenerated = await lab.send(`${RESPONSE}/regenerate`, 'POST', { seed: 1 })
  const { revision } = (await regenerated.json()) as { revision: string }
  return { revision, body: preview.body }
}

describe('POST /api/schema/import', () => {
  it('returns a snapshot for a pasted model', async ({ lab }) => {
    lab.writeMocks({ 'GET /x': { default: 'ok', responses: { ok: { status: 200 } } } })
    await lab.start()

    const res = await lab.send('/api/schema/import', 'POST', {
      source: { kind: 'typescript-paste', source: TODO },
    })

    expect(res.status).toBe(200)
    const { snapshot } = (await res.json()) as { snapshot: SchemaSnapshot }
    expect(snapshot.name).toBe('Todo')
    expect(snapshot.source).toEqual({ kind: 'typescript-paste' })
    expect(snapshot.document['$schema']).toBe('https://json-schema.org/draft/2020-12/schema')
  })

  it('names the known kinds when no adapter serves the one asked for', async ({ lab }) => {
    lab.writeMocks({ 'GET /x': { default: 'ok', responses: { ok: { status: 200 } } } })
    await lab.start()

    const res = await lab.send('/api/schema/import', 'POST', { source: { kind: 'protobuf' } })

    expect(res.status).toBe(422)
    const failure = (await res.json()) as { message: string; diagnostics: { code: string }[] }
    expect(failure.message).toContain('json-schema')
    expect(failure.diagnostics[0]?.code).toBe('adapter.unknown')
  })

  it('refuses a source that is not an object', async ({ lab }) => {
    lab.writeMocks({ 'GET /x': { default: 'ok', responses: { ok: { status: 200 } } } })
    await lab.start()

    expect((await lab.send('/api/schema/import', 'POST', { source: 'a string' })).status).toBe(400)
  })
})

describe('POST /api/schema/preview', () => {
  it('generates from a snapshot, and the same seed repeats the body', async ({ lab }) => {
    lab.writeMocks({ 'GET /x': { default: 'ok', responses: { ok: { status: 200 } } } })
    await lab.start()

    const imported = await lab.send('/api/schema/import', 'POST', {
      source: { kind: 'typescript-paste', source: TODO },
    })
    const { snapshot } = (await imported.json()) as { snapshot: SchemaSnapshot }

    const first = await lab.send('/api/schema/preview', 'POST', { snapshot, seed: 7 })
    const second = await lab.send('/api/schema/preview', 'POST', { snapshot, seed: 7 })

    expect(first.status).toBe(200)
    const one = (await first.json()) as { body: unknown; evidence: { seed: number } }
    const two = (await second.json()) as { body: unknown }
    expect(one.body).toEqual(two.body)
    expect(one.evidence.seed).toBe(7)
  })

  it('refuses a snapshot that is not one', async ({ lab }) => {
    lab.writeMocks({ 'GET /x': { default: 'ok', responses: { ok: { status: 200 } } } })
    await lab.start()

    const res = await lab.send('/api/schema/preview', 'POST', { snapshot: { nope: 1 } })
    expect(res.status).toBe(400)
  })
})

describe('regenerating a response', () => {
  it('generates from the stored schema and reports the revision to apply against', async ({
    lab,
  }) => {
    const seeded = await seedGeneratedResponse(lab)

    const res = await lab.send(`${RESPONSE}/regenerate`, 'POST', { seed: 99 })

    expect(res.status).toBe(200)
    const result = (await res.json()) as { body: unknown; revision: string }
    expect(result.revision).toBe(seeded.revision)
    // Nothing was written: regenerate is a preview.
    expect(lab.readMocks()['GET /todos']?.responses['ok']?.['body']).toEqual(seeded.body)
  })

  it('refuses a response with no schema instead of inferring one', async ({ lab }) => {
    lab.writeMocks({
      'GET /todos': { default: 'ok', responses: { ok: { status: 200, body: { id: 1 } } } },
    })
    await lab.start()

    const res = await lab.send(`${RESPONSE}/regenerate`, 'POST', {})

    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('no schema')
  })

  it('404s an endpoint or response that does not exist', async ({ lab }) => {
    lab.writeMocks({ 'GET /todos': { default: 'ok', responses: { ok: { status: 200 } } } })
    await lab.start()

    const ghost = `/api/endpoints/${encodeURIComponent('GET /todos')}/responses/ghost/regenerate`
    expect((await lab.send(ghost, 'POST', {})).status).toBe(404)
  })
})

describe('applying a generated body', () => {
  it('writes the body and its evidence, and reports the new revision', async ({ lab }) => {
    const seeded = await seedGeneratedResponse(lab)
    const regenerated = await lab.send(`${RESPONSE}/regenerate`, 'POST', { seed: 99 })
    const next = (await regenerated.json()) as { body: unknown; evidence: unknown }

    const res = await lab.send(`${RESPONSE}/body`, 'PUT', {
      body: next.body,
      evidence: next.evidence,
      revision: seeded.revision,
    })

    expect(res.status).toBe(200)
    const stored = lab.readMocks()['GET /todos']?.responses['ok']
    expect(stored?.['body']).toEqual(next.body)
    expect(stored?.['generation']).toEqual(next.evidence)
    expect(((await res.json()) as { revision: string }).revision).not.toBe(seeded.revision)
  })

  it('409s a revision that is no longer current, and says what it is now', async ({ lab }) => {
    const seeded = await seedGeneratedResponse(lab)
    const regenerated = await lab.send(`${RESPONSE}/regenerate`, 'POST', { seed: 99 })
    const next = (await regenerated.json()) as { body: unknown; evidence: unknown }
    await lab.send(`${RESPONSE}/body`, 'PUT', { ...next, revision: seeded.revision })

    const res = await lab.send(`${RESPONSE}/body`, 'PUT', { ...next, revision: seeded.revision })

    expect(res.status).toBe(409)
    const failure = (await res.json()) as { reason: string; revision: string }
    expect(failure.reason).toBe('stale-revision')
    expect(failure.revision).not.toBe(seeded.revision)
  })

  it('409s a hand-written body until the caller confirms', async ({ lab }) => {
    lab.writeMocks({
      'GET /todos': {
        default: 'ok',
        responses: { ok: { status: 200, body: { written: 'by hand' } } },
      },
    })
    const handle = await lab.start()

    const imported = await lab.send('/api/schema/import', 'POST', {
      source: { kind: 'typescript-paste', source: TODO },
    })
    const { snapshot } = (await imported.json()) as { snapshot: SchemaSnapshot }
    const previewed = await lab.send('/api/schema/preview', 'POST', { snapshot, seed: 3 })
    const preview = (await previewed.json()) as { body: unknown; evidence: unknown }

    // No stored schema, so the revision comes from a read the panel already
    // has: write it once, so regenerate can report it.
    lab.writeMocks({
      'GET /todos': {
        default: 'ok',
        responses: { ok: { status: 200, body: { written: 'by hand' }, schema: snapshot } },
      },
    })
    handle.reload()
    const regenerated = await lab.send(`${RESPONSE}/regenerate`, 'POST', {})
    const { revision } = (await regenerated.json()) as { revision: string }

    const refused = await lab.send(`${RESPONSE}/body`, 'PUT', {
      body: preview.body,
      evidence: preview.evidence,
      revision,
    })

    expect(refused.status).toBe(409)
    expect(((await refused.json()) as { reason: string }).reason).toBe('body-unverified')
    expect(lab.readMocks()['GET /todos']?.responses['ok']?.['body']).toEqual({ written: 'by hand' })

    const confirmed = await lab.send(`${RESPONSE}/body`, 'PUT', {
      body: preview.body,
      evidence: preview.evidence,
      revision,
      confirm: true,
    })

    expect(confirmed.status).toBe(200)
    expect(lab.readMocks()['GET /todos']?.responses['ok']?.['body']).toEqual(preview.body)
  })

  it('serves the applied body on the next request, without a restart', async ({ lab }) => {
    const seeded = await seedGeneratedResponse(lab)
    const regenerated = await lab.send(`${RESPONSE}/regenerate`, 'POST', { seed: 99 })
    const next = (await regenerated.json()) as { body: unknown; evidence: unknown }
    await lab.send(`${RESPONSE}/body`, 'PUT', { ...next, revision: seeded.revision })

    const served = await lab.get('/todos')
    expect(await served.json()).toEqual(next.body)
  })
})

describe('refreshing a schema', () => {
  it('re-reads the source file, replaces the schema, and leaves the body alone', async ({
    lab,
  }) => {
    writeFileSync(
      join(lab.root, 'todo.schema.json'),
      JSON.stringify({ type: 'object', properties: { id: { type: 'number' } } }),
      'utf8',
    )
    lab.writeMocks({
      'GET /todos': { default: 'ok', responses: { ok: { status: 200, body: null } } },
    })
    const handle = await lab.start()

    const imported = await lab.send('/api/schema/import', 'POST', {
      source: {
        kind: 'json-schema',
        document: { type: 'object', properties: { id: { type: 'number' } } },
        name: 'Todo',
        file: 'todo.schema.json',
      },
    })
    const { snapshot } = (await imported.json()) as { snapshot: SchemaSnapshot }
    lab.writeMocks({
      'GET /todos': {
        default: 'ok',
        responses: { ok: { status: 200, body: { kept: true }, schema: snapshot } },
      },
    })
    handle.reload()

    const regenerated = await lab.send(`${RESPONSE}/regenerate`, 'POST', {})
    const { revision } = (await regenerated.json()) as { revision: string }

    // The source changes on disk, the way a developer's types would.
    writeFileSync(
      join(lab.root, 'todo.schema.json'),
      JSON.stringify({ type: 'object', properties: { id: { type: 'string' } } }),
      'utf8',
    )

    const res = await lab.send(`${RESPONSE}/schema/refresh`, 'POST', { revision })

    expect(res.status).toBe(200)
    const stored = lab.readMocks()['GET /todos']?.responses['ok']
    expect(stored?.['schema']).toMatchObject({
      document: { properties: { id: { type: 'string' } } },
    })
    expect(stored?.['body']).toEqual({ kept: true })
  })

  it('says a pasted model has no source to re-read', async ({ lab }) => {
    await seedGeneratedResponse(lab)
    const regenerated = await lab.send(`${RESPONSE}/regenerate`, 'POST', {})
    const { revision } = (await regenerated.json()) as { revision: string }

    const res = await lab.send(`${RESPONSE}/schema/refresh`, 'POST', { revision })

    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('paste it again')
  })

  it('refuses a source that resolves outside the source root', async ({ lab }) => {
    writeFileSync(join(lab.root, 'outside.json'), JSON.stringify({ type: 'string' }), 'utf8')
    lab.writeMocks({
      'GET /todos': {
        default: 'ok',
        responses: {
          ok: {
            status: 200,
            body: null,
            schema: {
              name: 'Todo',
              document: {
                $schema: 'https://json-schema.org/draft/2020-12/schema',
                type: 'string',
              },
              source: { kind: 'json-schema', file: '../outside.json' },
              diagnostics: [],
            },
          },
        },
      },
    })
    await lab.start({
      config: ConfigSchema.parse({ port: 0, host: '127.0.0.1', schemaSources: { root: 'laqi' } }),
    })

    const regenerated = await lab.send(`${RESPONSE}/regenerate`, 'POST', {})
    const { revision } = (await regenerated.json()) as { revision: string }

    const res = await lab.send(`${RESPONSE}/schema/refresh`, 'POST', { revision })

    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('outside')
  })
})

describe('the budgets, through a live server', () => {
  it('400s a stored schema nested past the depth budget, with a real message', async ({ lab }) => {
    // Deep enough to clear the compiler's MAX_SHAPE_DEPTH (500) with room to
    // spare, but shallow enough that serialising the fixture itself does not
    // hit its own stack limit.
    let document: Record<string, unknown> = { type: 'string' }
    for (let i = 0; i < 2_000; i++) document = { type: 'array', items: document }
    lab.writeMocks({
      'GET /todos': {
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
    await lab.start()

    const res = await lab.send(`${RESPONSE}/regenerate`, 'POST', {})

    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toMatch(/nests deeper|depth/i)
  })

  it('400s a model that would blow the generation budget, instead of a bare 500', async ({
    lab,
  }) => {
    lab.writeMocks({ 'GET /x': { default: 'ok', responses: { ok: { status: 200 } } } })
    await lab.start()

    // string[][][] at arrayLength 100 is 100^3 = 1,000,000 leaf values.
    const imported = await lab.send('/api/schema/import', 'POST', {
      source: { kind: 'typescript-paste', source: 'export interface Big { a: string[][][] }' },
    })
    const { snapshot } = (await imported.json()) as { snapshot: SchemaSnapshot }

    const res = await lab.send('/api/schema/preview', 'POST', { snapshot, arrayLength: 100 })

    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toMatch(/more than 100000 values/)
  })
})

describe('executing a project module, from the panel', () => {
  /**
   * A Standard JSON Schema source with no dependencies.
   *
   * Self-contained on purpose: whether laqi reads what Zod and ArkType
   * actually emit is settled in packages/generate against the installed
   * libraries. What is under test here is the two-step approval — resolve,
   * show, confirm — and making it also depend on module resolution inside a
   * temporary directory would only give it a second way to fail.
   */
  function writeTypes(
    lab: Lab,
    properties = `{ id: { type: 'string' }, total: { type: 'number' } }`,
  ) {
    mkdirSync(join(lab.root, 'src'), { recursive: true })
    writeFileSync(
      join(lab.root, 'src', 'types.ts'),
      `export const Invoice = {\n` +
        `  '~standard': {\n` +
        `    version: 1,\n` +
        `    vendor: 'handwritten',\n` +
        `    validate: (value) => ({ value }),\n` +
        `    jsonSchema: {\n` +
        `      output: () => ({ type: 'object', properties: ${properties}, required: ['id'] }),\n` +
        `      input: () => ({ type: 'object', properties: ${properties}, required: ['id'] }),\n` +
        `    },\n` +
        `  },\n` +
        `}\n`,
      'utf8',
    )
  }

  const ask = { file: 'src/types.ts', exportName: 'Invoice', side: 'output' }

  it('resolves and shows the file without running it, then imports on confirm', async ({ lab }) => {
    writeTypes(lab)
    lab.writeMocks({ 'GET /x': { default: 'ok', responses: { ok: { status: 200 } } } })
    await lab.start()

    const prepared = await lab.send('/api/schema/module/prepare', 'POST', ask)
    expect(prepared.status).toBe(200)
    const ready = (await prepared.json()) as { token: string; resolvedPath: string }
    expect(ready.resolvedPath).toContain('src/types.ts')
    expect(ready.token).toMatch(/^[0-9a-f]{64}$/)

    const confirmed = await lab.send('/api/schema/module/confirm', 'POST', { token: ready.token })
    expect(confirmed.status).toBe(200)
    const { snapshot } = (await confirmed.json()) as { snapshot: SchemaSnapshot }
    expect(snapshot.name).toBe('Invoice')
    expect(snapshot.source).toEqual({
      kind: 'project-module',
      file: 'src/types.ts',
      exportName: 'Invoice',
      side: 'output',
    })
  })

  it('refuses a second confirmation with the same token', async ({ lab }) => {
    writeTypes(lab)
    lab.writeMocks({ 'GET /x': { default: 'ok', responses: { ok: { status: 200 } } } })
    await lab.start()

    const prepared = await lab.send('/api/schema/module/prepare', 'POST', ask)
    const { token } = (await prepared.json()) as { token: string }
    await lab.send('/api/schema/module/confirm', 'POST', { token })

    const again = await lab.send('/api/schema/module/confirm', 'POST', { token })

    expect(again.status).toBe(400)
  })

  it('refuses a confirmation once the file has changed underneath it', async ({ lab }) => {
    writeTypes(lab)
    lab.writeMocks({ 'GET /x': { default: 'ok', responses: { ok: { status: 200 } } } })
    await lab.start()

    const prepared = await lab.send('/api/schema/module/prepare', 'POST', ask)
    const { token } = (await prepared.json()) as { token: string }
    writeTypes(lab, `{ id: { type: 'string' } }`)

    const confirmed = await lab.send('/api/schema/module/confirm', 'POST', { token })

    expect(confirmed.status).toBe(400)
    expect(((await confirmed.json()) as { message: string }).message).toContain('changed')
  })

  // The only approval that counts is one laqi handed out. A caller asserting
  // it has approved itself is not approval.
  it('does not treat a confirmed flag as approval', async ({ lab }) => {
    writeTypes(lab)
    lab.writeMocks({ 'GET /x': { default: 'ok', responses: { ok: { status: 200 } } } })
    await lab.start()

    const res = await lab.send('/api/schema/module/confirm', 'POST', { ...ask, confirmed: true })

    expect(res.status).toBe(400)
  })

  it('sends a project module through the two-step flow, not the plain import', async ({ lab }) => {
    writeTypes(lab)
    lab.writeMocks({ 'GET /x': { default: 'ok', responses: { ok: { status: 200 } } } })
    await lab.start()

    const res = await lab.send('/api/schema/import', 'POST', {
      source: { kind: 'project-module', ...ask },
    })

    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('module/prepare')
  })

  it('refuses to prepare a path outside the source root', async ({ lab }) => {
    writeTypes(lab)
    lab.writeMocks({ 'GET /x': { default: 'ok', responses: { ok: { status: 200 } } } })
    await lab.start({
      config: ConfigSchema.parse({ port: 0, host: '127.0.0.1', schemaSources: { root: 'laqi' } }),
    })

    const res = await lab.send('/api/schema/module/prepare', 'POST', {
      ...ask,
      file: '../src/types.ts',
    })

    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('outside')
  })
})

describe('exporting a stored schema', () => {
  async function seedSchema(lab: Lab): Promise<SchemaSnapshot> {
    lab.writeMocks({ 'GET /x': { default: 'ok', responses: { ok: { status: 200 } } } })
    await lab.start()
    const imported = await lab.send('/api/schema/import', 'POST', {
      source: {
        kind: 'typescript-paste',
        source: 'export interface Point { at: [number, number] }',
      },
    })
    return ((await imported.json()) as { snapshot: SchemaSnapshot }).snapshot
  }

  it('prints the schema and reports what the target could not express', async ({ lab }) => {
    const snapshot = await seedSchema(lab)

    const res = await lab.send('/api/schema/export', 'POST', { snapshot })

    expect(res.status).toBe(200)
    const exported = (await res.json()) as {
      code: string
      language: string
      origin: string
      diagnostics: { code: string }[]
    }
    expect(exported.origin).toBe('schema')
    expect(exported.language).toBe('typescript')
    expect(exported.code).toContain('Point')
    // laqi prints TypeScript itself, with a real tuple: nothing to report.
    expect(exported.code).toContain('at: [number, number];')
    expect(exported.diagnostics).toEqual([])

    // Every other language goes through quicktype, which renders no
    // fixed-arity tuple, and says so.
    const python = await lab.send('/api/schema/export', 'POST', { snapshot, target: 'python' })
    const translated = (await python.json()) as { diagnostics: { code: string }[] }
    expect(translated.diagnostics.map((item) => item.code)).toContain('export.tuple-approximated')
  })

  // Export is a read. A route that both prints and writes would make copying
  // types a thing that changes the project.
  it('writes nothing to the mock file', async ({ lab }) => {
    const snapshot = await seedSchema(lab)
    const before = readFileSync(join(lab.root, 'laqi', 'api.json'), 'utf8')

    await lab.send('/api/schema/export', 'POST', { snapshot })
    await lab.send('/api/schema/export', 'POST', { snapshot, target: 'python' })

    expect(readFileSync(join(lab.root, 'laqi', 'api.json'), 'utf8')).toBe(before)
  })

  it('lists what this build serves, and every listed target prints', async ({ lab }) => {
    lab.writeMocks({ 'GET /x': { default: 'ok', responses: { ok: { status: 200 } } } })
    await lab.start()

    const res = await lab.send('/api/schema/capabilities', 'GET')

    expect(res.status).toBe(200)
    const listed = (await res.json()) as { inputs: string[]; exports: { targets: string[] } }
    expect(listed.inputs).toContain('openapi')
    expect(listed.inputs).toContain('project-module')
    expect(listed.exports.targets).toContain('typescript')
  })
})

describe('giving a response a schema it never had', () => {
  it('turns a body into a model, stores it, and unblocks regenerate', async ({ lab }) => {
    lab.writeMocks({
      'GET /todos': {
        default: 'ok',
        responses: { ok: { status: 200, body: { id: 1, title: 'write it down' } } },
      },
    })
    await lab.start()

    // Before: there is nothing to regenerate from, and laqi says so.
    const refused = await lab.send(`${RESPONSE}/regenerate`, 'POST', {})
    expect(refused.status).toBe(400)

    // The draft is the body as a model, keys where the body had them — not
    // the export route, which prints through quicktype and alphabetises.
    const drafted = await lab.send(`${RESPONSE}/model`, 'GET')
    expect(drafted.status).toBe(200)
    const { source, typeName } = (await drafted.json()) as { source: string; typeName: string }
    expect(source).toContain(`export interface ${typeName}`)
    expect(source.indexOf('id:')).toBeLessThan(source.indexOf('title:'))

    const imported = await lab.send('/api/schema/import', 'POST', {
      source: { kind: 'typescript-paste', source, typeName },
    })
    const { snapshot } = (await imported.json()) as { snapshot: SchemaSnapshot }

    const revision = await lab.send(`${RESPONSE}/revision`, 'GET')
    const { revision: current } = (await revision.json()) as { revision: string }

    const stored = await lab.send(`${RESPONSE}/schema`, 'PUT', { snapshot, revision: current })
    expect(stored.status).toBe(200)

    // The body is untouched — this wrote a schema, not data.
    expect(lab.readMocks()['GET /todos']?.responses['ok']?.['body']).toEqual({
      id: 1,
      title: 'write it down',
    })
    expect(lab.readMocks()['GET /todos']?.responses['ok']?.['schema']).toMatchObject({
      source: { kind: 'typescript-paste' },
    })

    // After: regenerate works, and the types now come from the schema.
    const allowed = await lab.send(`${RESPONSE}/regenerate`, 'POST', { seed: 4 })
    expect(allowed.status).toBe(200)
    const regenerated = (await allowed.json()) as { body: Record<string, unknown> }
    expect(typeof regenerated.body['title']).toBe('string')
    // The order is the contract: what the sample had is what every body has.
    expect(Object.keys(regenerated.body)).toEqual(['id', 'title'])
  })

  it('refuses a stale revision, like every other write', async ({ lab }) => {
    lab.writeMocks({
      'GET /todos': { default: 'ok', responses: { ok: { status: 200, body: { id: 1 } } } },
    })
    await lab.start()

    const res = await lab.send(`${RESPONSE}/schema`, 'PUT', {
      snapshot: {
        name: 'Todo',
        document: { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object' },
        source: { kind: 'typescript-paste' },
        diagnostics: [],
      },
      revision: 'not-the-current-one',
    })

    expect(res.status).toBe(409)
    expect(((await res.json()) as { reason: string }).reason).toBe('stale-revision')
  })
})
