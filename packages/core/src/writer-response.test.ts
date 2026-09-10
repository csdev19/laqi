import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { bodyHash } from './canonical-json'
import { readResponseRevision, updateResponseInFile } from './writer'

let root: string
const FILE = 'api.json'

/** A response laqi generated: its evidence matches the body on disk. */
function generated(body: unknown) {
  return {
    status: 200,
    body,
    schema: {
      name: 'User',
      document: { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object' },
      source: { kind: 'typescript-paste' as const },
      diagnostics: [],
    },
    generation: { seed: 7, options: { arrayLength: 3 }, bodyHash: bodyHash(body) },
  }
}

function write(endpoint: unknown): void {
  writeFileSync(join(root, FILE), `${JSON.stringify({ 'GET /users': endpoint }, null, 2)}\n`)
}

function read(): Record<string, { responses: Record<string, Record<string, unknown>> }> {
  return JSON.parse(readFileSync(join(root, FILE), 'utf8')) as never
}

function revisionOf(response = 'ok'): string {
  const result = readResponseRevision({
    root,
    bounds: [root],
    file: FILE,
    id: 'GET /users',
    response,
  })
  if (!result.ok) throw new Error(result.error)
  return result.revision
}

function apply(params: { revision: string; body: unknown; confirm?: boolean }) {
  return updateResponseInFile({
    root,
    bounds: [root],
    file: FILE,
    id: 'GET /users',
    response: 'ok',
    revision: params.revision,
    confirm: params.confirm,
    patch: {
      body: params.body,
      generation: { seed: 9, options: { arrayLength: 3 }, bodyHash: bodyHash(params.body) },
    },
  })
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'laqi-response-'))
  write({ default: 'ok', responses: { ok: generated({ id: 1 }) } })
})

describe('applying a generated body', () => {
  it('replaces a body laqi generated, and reports the new revision', () => {
    const before = revisionOf()
    const result = apply({ revision: before, body: { id: 2 } })

    expect(result).toMatchObject({ ok: true })
    expect(read()['GET /users']?.responses['ok']?.['body']).toEqual({ id: 2 })
    expect(result.ok && result.revision).toBe(revisionOf())
    expect(result.ok && result.revision).not.toBe(before)
  })

  it('refuses a revision that is no longer current', () => {
    const stale = revisionOf()
    apply({ revision: stale, body: { id: 2 } })

    const result = apply({ revision: stale, body: { id: 3 } })

    expect(result).toMatchObject({ ok: false, conflict: { reason: 'stale-revision' } })
    expect(result.ok === false && result.conflict?.revision).toBe(revisionOf())
    expect(read()['GET /users']?.responses['ok']?.['body']).toEqual({ id: 2 })
  })

  it('refuses a stale revision even with confirm, because the decision was about another file', () => {
    const stale = revisionOf()
    apply({ revision: stale, body: { id: 2 } })

    const result = apply({ revision: stale, body: { id: 3 }, confirm: true })

    expect(result).toMatchObject({ ok: false, conflict: { reason: 'stale-revision' } })
  })

  it('refuses a body that was never generated, naming it as unverified', () => {
    write({ default: 'ok', responses: { ok: { status: 200, body: { handwritten: true } } } })

    const result = apply({ revision: revisionOf(), body: { id: 2 } })

    expect(result).toMatchObject({ ok: false, conflict: { reason: 'body-unverified' } })
    expect(read()['GET /users']?.responses['ok']?.['body']).toEqual({ handwritten: true })
  })

  it('refuses a body edited since laqi wrote it', () => {
    const stored = generated({ id: 1 })
    write({ default: 'ok', responses: { ok: { ...stored, body: { id: 1, edited: 'by hand' } } } })

    const result = apply({ revision: revisionOf(), body: { id: 2 } })

    expect(result).toMatchObject({ ok: false, conflict: { reason: 'body-modified' } })
  })

  it('applies an unverified body when the caller confirms', () => {
    write({ default: 'ok', responses: { ok: { status: 200, body: { handwritten: true } } } })

    const result = apply({ revision: revisionOf(), body: { id: 2 }, confirm: true })

    expect(result).toMatchObject({ ok: true })
    expect(read()['GET /users']?.responses['ok']?.['body']).toEqual({ id: 2 })
  })

  it('leaves every other key of the response exactly as it was', () => {
    write({
      default: 'ok',
      responses: { ok: { ...generated({ id: 1 }), delay: 40, headers: { 'x-trace': 'abc' } } },
    })

    apply({ revision: revisionOf(), body: { id: 2 } })

    const stored = read()['GET /users']?.responses['ok']
    expect(stored?.['delay']).toBe(40)
    expect(stored?.['headers']).toEqual({ 'x-trace': 'abc' })
    expect(stored?.['schema']).toMatchObject({ name: 'User' })
  })

  it('refuses a patch that would make the endpoint invalid, and writes nothing', () => {
    const result = updateResponseInFile({
      root,
      bounds: [root],
      file: FILE,
      id: 'GET /users',
      response: 'ok',
      revision: revisionOf(),
      patch: { body: { id: 2 }, generation: { seed: 1, options: {}, bodyHash: 'not-a-hash' } },
    })

    expect(result.ok).toBe(false)
    expect(read()['GET /users']?.responses['ok']?.['body']).toEqual({ id: 1 })
  })
})

describe('refreshing a schema', () => {
  const nextSchema = {
    name: 'User',
    document: { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'string' },
    source: { kind: 'typescript-paste' as const },
    diagnostics: [],
  }

  function refresh(revision: string) {
    return updateResponseInFile({
      root,
      bounds: [root],
      file: FILE,
      id: 'GET /users',
      response: 'ok',
      revision,
      patch: { schema: nextSchema },
    })
  }

  it('changes the schema and nothing else', () => {
    const before = read()['GET /users']?.responses['ok']

    const result = refresh(revisionOf())

    expect(result).toMatchObject({ ok: true })
    const after = read()['GET /users']?.responses['ok']
    expect(after?.['schema']).toMatchObject({ document: { type: 'string' } })
    expect(after?.['body']).toEqual(before?.['body'])
    expect(after?.['generation']).toEqual(before?.['generation'])
  })

  it('needs no confirmation on an unverified body, because it does not touch it', () => {
    write({ default: 'ok', responses: { ok: { status: 200, body: { handwritten: true } } } })

    expect(refresh(revisionOf())).toMatchObject({ ok: true })
    expect(read()['GET /users']?.responses['ok']?.['body']).toEqual({ handwritten: true })
  })

  it('still refuses a stale revision', () => {
    const stale = revisionOf()
    refresh(stale)

    expect(refresh(stale)).toMatchObject({ ok: false, conflict: { reason: 'stale-revision' } })
  })
})

describe('reaching a response', () => {
  it('names the declared responses when the one asked for is absent', () => {
    const result = readResponseRevision({
      root,
      bounds: [root],
      file: FILE,
      id: 'GET /users',
      response: 'missing',
    })

    expect(result).toMatchObject({ ok: false })
    expect(result.ok === false && result.error).toContain('ok')
  })

  it('refuses a file outside the mocks area before reading it', () => {
    const result = readResponseRevision({
      root,
      bounds: [join(root, 'laqi')],
      file: '../escape.json',
      id: 'GET /users',
      response: 'ok',
    })

    expect(result).toMatchObject({ ok: false })
    expect(result.ok === false && result.error).toContain('outside')
  })
})
