import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createEndpointInFile, deleteEndpointFromFile, updateEndpointInFile } from './writer'

let sandbox: string
let root: string

beforeEach(() => {
  // root anidado a propósito: los tests de contención escriben hacia
  // afuera, y tienen que caer en un lugar que este test sea dueño de
  // limpiar — no en el tmpdir compartido de la máquina.
  sandbox = mkdtempSync(join(tmpdir(), 'laqi-writer-'))
  root = join(sandbox, 'project')
  mkdirSync(root, { recursive: true })
})

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true })
})

function writeMock(relative: string, contents: unknown) {
  const full = join(root, relative)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, JSON.stringify(contents, null, 2), 'utf8')
}

function readMock(relative: string): unknown {
  return JSON.parse(readFileSync(join(root, relative), 'utf8'))
}

const okDefinition = { default: 'ok', responses: { ok: { status: 200, body: [] } } }

describe('updateEndpointInFile', () => {
  it('replaces the value at the existing key, in place', () => {
    writeMock('laqi/api.json', {
      'GET /users': { default: 'ok', responses: { ok: { status: 200, body: [] } } },
      'GET /orders': { default: 'ok', responses: { ok: { status: 200, body: [] } } },
    })

    const updated = {
      default: 'empty',
      responses: { ok: { status: 200, body: [] }, empty: { status: 200, body: [] } },
    }
    const result = updateEndpointInFile({ root, file: 'laqi/api.json', id: 'GET /users', definition: updated })

    expect(result.ok).toBe(true)
    const contents = readMock('laqi/api.json') as Record<string, unknown>
    expect(contents['GET /users']).toEqual(updated)
    expect(contents['GET /orders']).toEqual({ default: 'ok', responses: { ok: { status: 200, body: [] } } })
  })

  it('preserves sibling key order', () => {
    writeMock('laqi/api.json', { a: okDefinition, b: okDefinition, c: okDefinition })
    updateEndpointInFile({ root, file: 'laqi/api.json', id: 'b', definition: { default: 'ok', responses: { ok: { status: 201, body: {} } } } })
    expect(Object.keys(readMock('laqi/api.json') as object)).toEqual(['a', 'b', 'c'])
  })

  it('rejects an invalid definition without writing anything', () => {
    writeMock('laqi/api.json', { 'GET /users': okDefinition })
    const before = readFileSync(join(root, 'laqi/api.json'), 'utf8')

    const result = updateEndpointInFile({
      root,
      file: 'laqi/api.json',
      id: 'GET /users',
      definition: { default: 'nope', responses: { ok: { status: 200 } } } as never,
    })

    expect(result.ok).toBe(false)
    expect(readFileSync(join(root, 'laqi/api.json'), 'utf8')).toBe(before)
  })

  it('fails cleanly when the id does not exist in the file', () => {
    writeMock('laqi/api.json', { 'GET /users': okDefinition })
    const result = updateEndpointInFile({ root, file: 'laqi/api.json', id: 'GET /ghost', definition: okDefinition })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('GET /ghost')
  })

  it('fails cleanly when the file does not exist', () => {
    const result = updateEndpointInFile({ root, file: 'laqi/nope.json', id: 'GET /users', definition: okDefinition })
    expect(result.ok).toBe(false)
  })
})

describe('deleteEndpointFromFile', () => {
  it('removes the key and leaves siblings untouched', () => {
    writeMock('laqi/api.json', { 'GET /users': okDefinition, 'GET /orders': okDefinition })
    const result = deleteEndpointFromFile({ root, file: 'laqi/api.json', id: 'GET /users' })

    expect(result.ok).toBe(true)
    const contents = readMock('laqi/api.json') as Record<string, unknown>
    expect('GET /users' in contents).toBe(false)
    expect(contents['GET /orders']).toEqual(okDefinition)
  })

  it('fails cleanly when the id does not exist', () => {
    writeMock('laqi/api.json', { 'GET /users': okDefinition })
    const result = deleteEndpointFromFile({ root, file: 'laqi/api.json', id: 'GET /ghost' })
    expect(result.ok).toBe(false)
  })
})

describe('createEndpointInFile', () => {
  it('creates the file if it does not exist yet, with the one endpoint', () => {
    const result = createEndpointInFile({ root, file: 'laqi/api.json', id: 'GET /users', definition: okDefinition })

    expect(result.ok).toBe(true)
    expect(readMock('laqi/api.json')).toEqual({ 'GET /users': okDefinition })
  })

  it('appends to an existing file without touching its other keys', () => {
    writeMock('laqi/api.json', { 'GET /users': okDefinition })
    const result = createEndpointInFile({
      root,
      file: 'laqi/api.json',
      id: 'GET /orders',
      definition: { default: 'ok', responses: { ok: { status: 200, body: [] } } },
    })

    expect(result.ok).toBe(true)
    const contents = readMock('laqi/api.json') as Record<string, unknown>
    expect(contents['GET /users']).toEqual(okDefinition)
    expect(contents['GET /orders']).toBeDefined()
  })

  it('refuses to overwrite an id that already exists', () => {
    writeMock('laqi/api.json', { 'GET /users': okDefinition })
    const result = createEndpointInFile({ root, file: 'laqi/api.json', id: 'GET /users', definition: okDefinition })
    expect(result.ok).toBe(false)
  })

  it('rejects an invalid definition without creating the file', () => {
    const result = createEndpointInFile({
      root,
      file: 'laqi/api.json',
      id: 'GET /users',
      definition: { default: 'ghost', responses: { ok: { status: 200 } } } as never,
    })
    expect(result.ok).toBe(false)
    expect(existsSync(join(root, 'laqi/api.json'))).toBe(false)
  })
})

describe('containment', () => {
  // ADR-0006 lo pide explícitamente para el servidor MCP: un agente con
  // estas herramientas escribe archivos del proyecto y tiene que quedar
  // acotado al directorio de mocks. `join(root, file)` solo no alcanza.
  const escapes = [
    '../escaped.json',
    '../../escaped.json',
    'nested/../../escaped.json',
    '/etc/laqi-escaped.json',
  ]

  it('refuses to create outside the project root', () => {
    for (const file of escapes) {
      const result = createEndpointInFile({
        root,
        file,
        id: 'GET /x',
        definition: { default: 'ok', responses: { ok: { status: 200 } } },
      })
      expect(result).toEqual({ ok: false, error: expect.stringContaining('outside the project') })
      expect(existsSync(join(root, file))).toBe(false)
    }
  })

  it('refuses to update outside the project root', () => {
    for (const file of escapes) {
      expect(
        updateEndpointInFile({
          root,
          file,
          id: 'GET /x',
          definition: { default: 'ok', responses: { ok: { status: 200 } } },
        }),
      ).toEqual({ ok: false, error: expect.stringContaining('outside the project') })
    }
  })

  it('refuses to delete outside the project root', () => {
    for (const file of escapes) {
      expect(deleteEndpointFromFile({ root, file, id: 'GET /x' })).toEqual({
        ok: false,
        error: expect.stringContaining('outside the project'),
      })
    }
  })

  it('still allows a legitimate nested path inside the root', () => {
    const result = createEndpointInFile({
      root,
      file: 'laqi/nested/deep.json',
      id: 'GET /deep',
      definition: { default: 'ok', responses: { ok: { status: 200 } } },
    })
    expect(result).toEqual({ ok: true })
    expect(existsSync(join(root, 'laqi/nested/deep.json'))).toBe(true)
  })
})
