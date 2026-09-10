// apps/cli/src/serve.schema.test.ts
//
// The schema routes, end to end against a real listener. They are here and
// not in the server package because the conflict rules only mean anything
// with a real file underneath them: the whole point is what happens when the
// bytes on disk stop matching what the caller looked at.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ConfigSchema, type SchemaSnapshot } from '@laqi/schema'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { startServer, type ServeHandle } from './serve'

let root: string
let handle: ServeHandle | undefined

const config = ConfigSchema.parse({ port: 0, host: '127.0.0.1' })
const TODO = 'export interface Todo { id: number; title: string; done: boolean }'

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'laqi-schema-'))
  mkdirSync(join(root, 'laqi'), { recursive: true })
})

afterEach(async () => {
  await handle?.close()
  handle = undefined
  rmSync(root, { recursive: true, force: true })
})

function writeMocks(contents: Record<string, unknown>) {
  writeFileSync(join(root, 'laqi', 'api.json'), JSON.stringify(contents, null, 2), 'utf8')
}

function readMocks(): Record<string, { responses: Record<string, Record<string, unknown>> }> {
  return JSON.parse(readFileSync(join(root, 'laqi', 'api.json'), 'utf8')) as never
}

const send = (path: string, method: string, body?: unknown) =>
  fetch(`http://127.0.0.1:${handle?.port}/__laqi${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

const RESPONSE = `/api/endpoints/${encodeURIComponent('GET /todos')}/responses/ok`

/** Imports a model, previews a body, and writes both onto `GET /todos`. */
async function seedGeneratedResponse(): Promise<{ revision: string; body: unknown }> {
  writeMocks({ 'GET /todos': { default: 'ok', responses: { ok: { status: 200, body: null } } } })
  handle = await startServer({ root, config })

  const imported = await send('/api/schema/import', 'POST', {
    source: { kind: 'typescript-paste', source: TODO },
  })
  const { snapshot } = (await imported.json()) as { snapshot: SchemaSnapshot }

  const previewed = await send('/api/schema/preview', 'POST', { snapshot, seed: 42 })
  const preview = (await previewed.json()) as { body: unknown; evidence: unknown }

  // The seeded response has no evidence yet, so the first write confirms.
  const current = readMocks()['GET /todos']?.responses['ok']
  writeMocks({
    'GET /todos': {
      default: 'ok',
      responses: {
        ok: { ...current, body: preview.body, generation: preview.evidence, schema: snapshot },
      },
    },
  })
  handle.reload()

  const regenerated = await send(`${RESPONSE}/regenerate`, 'POST', { seed: 1 })
  const { revision } = (await regenerated.json()) as { revision: string }
  return { revision, body: preview.body }
}

describe('POST /api/schema/import', () => {
  it('returns a snapshot for a pasted model', async () => {
    writeMocks({ 'GET /x': { default: 'ok', responses: { ok: { status: 200 } } } })
    handle = await startServer({ root, config })

    const res = await send('/api/schema/import', 'POST', {
      source: { kind: 'typescript-paste', source: TODO },
    })

    expect(res.status).toBe(200)
    const { snapshot } = (await res.json()) as { snapshot: SchemaSnapshot }
    expect(snapshot.name).toBe('Todo')
    expect(snapshot.source).toEqual({ kind: 'typescript-paste' })
    expect(snapshot.document['$schema']).toBe('https://json-schema.org/draft/2020-12/schema')
  })

  it('names the known kinds when no adapter serves the one asked for', async () => {
    writeMocks({ 'GET /x': { default: 'ok', responses: { ok: { status: 200 } } } })
    handle = await startServer({ root, config })

    const res = await send('/api/schema/import', 'POST', { source: { kind: 'protobuf' } })

    expect(res.status).toBe(422)
    const failure = (await res.json()) as { message: string; diagnostics: { code: string }[] }
    expect(failure.message).toContain('json-schema')
    expect(failure.diagnostics[0]?.code).toBe('adapter.unknown')
  })

  it('refuses a source that is not an object', async () => {
    writeMocks({ 'GET /x': { default: 'ok', responses: { ok: { status: 200 } } } })
    handle = await startServer({ root, config })

    expect((await send('/api/schema/import', 'POST', { source: 'a string' })).status).toBe(400)
  })
})

describe('POST /api/schema/preview', () => {
  it('generates from a snapshot, and the same seed repeats the body', async () => {
    writeMocks({ 'GET /x': { default: 'ok', responses: { ok: { status: 200 } } } })
    handle = await startServer({ root, config })

    const imported = await send('/api/schema/import', 'POST', {
      source: { kind: 'typescript-paste', source: TODO },
    })
    const { snapshot } = (await imported.json()) as { snapshot: SchemaSnapshot }

    const first = await send('/api/schema/preview', 'POST', { snapshot, seed: 7 })
    const second = await send('/api/schema/preview', 'POST', { snapshot, seed: 7 })

    expect(first.status).toBe(200)
    const one = (await first.json()) as { body: unknown; evidence: { seed: number } }
    const two = (await second.json()) as { body: unknown }
    expect(one.body).toEqual(two.body)
    expect(one.evidence.seed).toBe(7)
  })

  it('refuses a snapshot that is not one', async () => {
    writeMocks({ 'GET /x': { default: 'ok', responses: { ok: { status: 200 } } } })
    handle = await startServer({ root, config })

    expect((await send('/api/schema/preview', 'POST', { snapshot: { nope: 1 } })).status).toBe(400)
  })
})

describe('regenerating a response', () => {
  it('generates from the stored schema and reports the revision to apply against', async () => {
    const seeded = await seedGeneratedResponse()

    const res = await send(`${RESPONSE}/regenerate`, 'POST', { seed: 99 })

    expect(res.status).toBe(200)
    const result = (await res.json()) as { body: unknown; revision: string }
    expect(result.revision).toBe(seeded.revision)
    // Nothing was written: regenerate is a preview.
    expect(readMocks()['GET /todos']?.responses['ok']?.['body']).toEqual(seeded.body)
  })

  it('refuses a response with no schema instead of inferring one', async () => {
    writeMocks({
      'GET /todos': { default: 'ok', responses: { ok: { status: 200, body: { id: 1 } } } },
    })
    handle = await startServer({ root, config })

    const res = await send(`${RESPONSE}/regenerate`, 'POST', {})

    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('no schema')
  })

  it('404s an endpoint or response that does not exist', async () => {
    writeMocks({ 'GET /todos': { default: 'ok', responses: { ok: { status: 200 } } } })
    handle = await startServer({ root, config })

    const ghost = `/api/endpoints/${encodeURIComponent('GET /todos')}/responses/ghost/regenerate`
    expect((await send(ghost, 'POST', {})).status).toBe(404)
  })
})

describe('applying a generated body', () => {
  it('writes the body and its evidence, and reports the new revision', async () => {
    const seeded = await seedGeneratedResponse()
    const regenerated = await send(`${RESPONSE}/regenerate`, 'POST', { seed: 99 })
    const next = (await regenerated.json()) as { body: unknown; evidence: unknown }

    const res = await send(`${RESPONSE}/body`, 'PUT', {
      body: next.body,
      evidence: next.evidence,
      revision: seeded.revision,
    })

    expect(res.status).toBe(200)
    const stored = readMocks()['GET /todos']?.responses['ok']
    expect(stored?.['body']).toEqual(next.body)
    expect(stored?.['generation']).toEqual(next.evidence)
    expect(((await res.json()) as { revision: string }).revision).not.toBe(seeded.revision)
  })

  it('409s a revision that is no longer current, and says what it is now', async () => {
    const seeded = await seedGeneratedResponse()
    const regenerated = await send(`${RESPONSE}/regenerate`, 'POST', { seed: 99 })
    const next = (await regenerated.json()) as { body: unknown; evidence: unknown }
    await send(`${RESPONSE}/body`, 'PUT', { ...next, revision: seeded.revision })

    const res = await send(`${RESPONSE}/body`, 'PUT', { ...next, revision: seeded.revision })

    expect(res.status).toBe(409)
    const failure = (await res.json()) as { reason: string; revision: string }
    expect(failure.reason).toBe('stale-revision')
    expect(failure.revision).not.toBe(seeded.revision)
  })

  it('409s a hand-written body until the caller confirms', async () => {
    writeMocks({
      'GET /todos': {
        default: 'ok',
        responses: { ok: { status: 200, body: { written: 'by hand' } } },
      },
    })
    handle = await startServer({ root, config })

    const imported = await send('/api/schema/import', 'POST', {
      source: { kind: 'typescript-paste', source: TODO },
    })
    const { snapshot } = (await imported.json()) as { snapshot: SchemaSnapshot }
    const previewed = await send('/api/schema/preview', 'POST', { snapshot, seed: 3 })
    const preview = (await previewed.json()) as { body: unknown; evidence: unknown }

    // No stored schema, so the revision comes from a read the panel already
    // has: write it once, so regenerate can report it.
    writeMocks({
      'GET /todos': {
        default: 'ok',
        responses: { ok: { status: 200, body: { written: 'by hand' }, schema: snapshot } },
      },
    })
    handle.reload()
    const regenerated = await send(`${RESPONSE}/regenerate`, 'POST', {})
    const { revision } = (await regenerated.json()) as { revision: string }

    const refused = await send(`${RESPONSE}/body`, 'PUT', {
      body: preview.body,
      evidence: preview.evidence,
      revision,
    })

    expect(refused.status).toBe(409)
    expect(((await refused.json()) as { reason: string }).reason).toBe('body-unverified')
    expect(readMocks()['GET /todos']?.responses['ok']?.['body']).toEqual({ written: 'by hand' })

    const confirmed = await send(`${RESPONSE}/body`, 'PUT', {
      body: preview.body,
      evidence: preview.evidence,
      revision,
      confirm: true,
    })

    expect(confirmed.status).toBe(200)
    expect(readMocks()['GET /todos']?.responses['ok']?.['body']).toEqual(preview.body)
  })

  it('serves the applied body on the next request, without a restart', async () => {
    const seeded = await seedGeneratedResponse()
    const regenerated = await send(`${RESPONSE}/regenerate`, 'POST', { seed: 99 })
    const next = (await regenerated.json()) as { body: unknown; evidence: unknown }
    await send(`${RESPONSE}/body`, 'PUT', { ...next, revision: seeded.revision })

    const served = await fetch(`http://127.0.0.1:${handle?.port}/todos`)
    expect(await served.json()).toEqual(next.body)
  })
})

describe('refreshing a schema', () => {
  it('re-reads the source file, replaces the schema, and leaves the body alone', async () => {
    writeFileSync(
      join(root, 'todo.schema.json'),
      JSON.stringify({ type: 'object', properties: { id: { type: 'number' } } }),
      'utf8',
    )
    writeMocks({ 'GET /todos': { default: 'ok', responses: { ok: { status: 200, body: null } } } })
    handle = await startServer({ root, config })

    const imported = await send('/api/schema/import', 'POST', {
      source: {
        kind: 'json-schema',
        document: { type: 'object', properties: { id: { type: 'number' } } },
        name: 'Todo',
        file: 'todo.schema.json',
      },
    })
    const { snapshot } = (await imported.json()) as { snapshot: SchemaSnapshot }
    writeMocks({
      'GET /todos': {
        default: 'ok',
        responses: { ok: { status: 200, body: { kept: true }, schema: snapshot } },
      },
    })
    handle.reload()

    const regenerated = await send(`${RESPONSE}/regenerate`, 'POST', {})
    const { revision } = (await regenerated.json()) as { revision: string }

    // The source changes on disk, the way a developer's types would.
    writeFileSync(
      join(root, 'todo.schema.json'),
      JSON.stringify({ type: 'object', properties: { id: { type: 'string' } } }),
      'utf8',
    )

    const res = await send(`${RESPONSE}/schema/refresh`, 'POST', { revision })

    expect(res.status).toBe(200)
    const stored = readMocks()['GET /todos']?.responses['ok']
    expect(stored?.['schema']).toMatchObject({
      document: { properties: { id: { type: 'string' } } },
    })
    expect(stored?.['body']).toEqual({ kept: true })
  })

  it('says a pasted model has no source to re-read', async () => {
    await seedGeneratedResponse()
    const regenerated = await send(`${RESPONSE}/regenerate`, 'POST', {})
    const { revision } = (await regenerated.json()) as { revision: string }

    const res = await send(`${RESPONSE}/schema/refresh`, 'POST', { revision })

    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('paste it again')
  })

  it('refuses a source that resolves outside the source root', async () => {
    writeFileSync(join(root, 'outside.json'), JSON.stringify({ type: 'string' }), 'utf8')
    writeMocks({
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
    handle = await startServer({
      root,
      config: ConfigSchema.parse({ port: 0, host: '127.0.0.1', schemaSources: { root: 'laqi' } }),
    })

    const regenerated = await send(`${RESPONSE}/regenerate`, 'POST', {})
    const { revision } = (await regenerated.json()) as { revision: string }

    const res = await send(`${RESPONSE}/schema/refresh`, 'POST', { revision })

    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('outside')
  })
})
