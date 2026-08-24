import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ConfigSchema } from '@laqi/schema'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { migrateV1, runMigrate } from './migrate'

const simple = {
  post: {
    method: 'GET',
    codeResponse: '200',
    responses: [
      { statusCode: '200', selectorCode: '200', body: { message: 'OK' } },
      { statusCode: '401', selectorCode: 'error401', body: { code: 'error2' } },
    ],
  },
}

describe('migrateV1', () => {
  it('turns a v1 endpoint into a "METHOD /path" key', () => {
    const { output } = migrateV1(simple)
    expect(Object.keys(output)).toEqual(['GET /post'])
  })

  it('turns codeResponse into default', () => {
    expect(migrateV1(simple).output['GET /post']?.default).toBe('200')
  })

  it('turns the responses array into an object keyed by selectorCode', () => {
    const responses = migrateV1(simple).output['GET /post']?.responses ?? {}
    expect(Object.keys(responses).sort()).toEqual(['200', 'error401'])
    expect(responses['error401']?.body).toEqual({ code: 'error2' })
  })

  it('coerces the string statusCode into a number (v1 defect I)', () => {
    expect(migrateV1(simple).output['GET /post']?.responses['200']?.status).toBe(200)
  })

  it('unwraps the (method) prefix hack', () => {
    const input = {
      '(get)files/:id': {
        method: 'GET',
        codeResponse: '200',
        responses: [{ statusCode: '200', selectorCode: '200', body: {} }],
      },
      '(delete)files/:id': {
        method: 'DELETE',
        codeResponse: '200',
        responses: [{ statusCode: '204', selectorCode: '200', body: {} }],
      },
    }
    expect(Object.keys(migrateV1(input).output).sort()).toEqual([
      'DELETE /files/:id',
      'GET /files/:id',
    ])
  })

  it('adds the leading slash a v1 key never had', () => {
    expect(Object.keys(migrateV1(simple).output)[0]).toContain('/post')
  })

  it('warns and skips a null entry instead of throwing (v1 defect B)', () => {
    const { output, warnings } = migrateV1({ ...simple, broken: null })
    expect(Object.keys(output)).toEqual(['GET /post'])
    expect(warnings.join(' ')).toContain('broken')
  })

  it('warns when codeResponse names no selector, and falls back to the first', () => {
    const input = {
      a: {
        method: 'GET',
        codeResponse: 'ghost',
        responses: [{ statusCode: '200', selectorCode: 'ok', body: {} }],
      },
    }
    const { output, warnings } = migrateV1(input)
    expect(output['GET /a']?.default).toBe('ok')
    expect(warnings.join(' ')).toContain('ghost')
  })

  it('disambiguates duplicate selectorCodes within an endpoint', () => {
    const input = {
      a: {
        method: 'GET',
        codeResponse: 'ok',
        responses: [
          { statusCode: '200', selectorCode: 'ok', body: { n: 1 } },
          { statusCode: '201', selectorCode: 'ok', body: { n: 2 } },
        ],
      },
    }
    const { output, warnings } = migrateV1(input)
    expect(Object.keys(output['GET /a']?.responses ?? {})).toEqual(['ok', 'ok-2'])
    expect(warnings.join(' ')).toContain('ok')
  })

  it('warns about a route that would collide after migration (ADR-0008)', () => {
    const input = {
      '(get)files': {
        method: 'GET',
        codeResponse: 'ok',
        responses: [{ statusCode: '200', selectorCode: 'ok', body: {} }],
      },
      files: {
        method: 'GET',
        codeResponse: 'ok',
        responses: [{ statusCode: '200', selectorCode: 'ok', body: {} }],
      },
    }
    expect(migrateV1(input).warnings.join(' ')).toContain('GET /files')
  })

  it('produces output that the v2 schema accepts', async () => {
    const { EndpointSchema, parseEndpointKey } = await import('@laqi/schema')
    const { output } = migrateV1(simple)

    for (const [key, definition] of Object.entries(output)) {
      expect(parseEndpointKey(key).ok).toBe(true)
      expect(EndpointSchema.safeParse(definition).success).toBe(true)
    }
  })

  it('returns nothing for input that is not an object', () => {
    expect(migrateV1('nope').output).toEqual({})
    expect(migrateV1(null).warnings.length).toBeGreaterThan(0)
  })
})

describe('runMigrate', () => {
  let root: string
  const config = ConfigSchema.parse({})

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'laqi-migrate-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('does not write a target file and reports failure when every source is unparseable (I7)', () => {
    mkdirSync(join(root, 'mock-data'), { recursive: true })
    writeFileSync(join(root, 'mock-data', 'api.json'), '{ this is not json }', 'utf8')

    const failed = runMigrate({ root, config, dryRun: false })

    expect(failed).toBe(true)
    expect(existsSync(join(root, config.file))).toBe(false)
  })

  it('writes the target file and reports success when at least one source converts', () => {
    mkdirSync(join(root, 'mock-data'), { recursive: true })
    writeFileSync(
      join(root, 'mock-data', 'api.json'),
      JSON.stringify({
        post: {
          method: 'GET',
          codeResponse: '200',
          responses: [{ statusCode: '200', selectorCode: '200', body: { message: 'OK' } }],
        },
      }),
      'utf8',
    )

    const failed = runMigrate({ root, config, dryRun: false })

    expect(failed).toBe(false)
    expect(existsSync(join(root, config.file))).toBe(true)
    expect(JSON.parse(readFileSync(join(root, config.file), 'utf8'))).toHaveProperty('GET /post')
  })
})
