import { buildRouteTable, loadMocks } from '@laqi/core'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createMockApp } from './mock-app'

/**
 * What a frontend receives must be what the mock file says. These go the
 * whole way a hand-written body goes — the text on disk, the loader, the
 * route table, the HTTP response — and compare what a client parses with
 * what the file holds. Numbers, dates and the JSON corners are where a
 * mock server quietly turns into a different API than the one being mocked.
 */
const BODY = String.raw`{
  "safeInteger": 9007199254740991,
  "negative": -42,
  "money": 19.99,
  "tenth": 0.1,
  "floatNoise": 0.30000000000000004,
  "huge": 1e21,
  "tiniest": 5e-324,
  "epochMillis": 1791295800000,
  "date": "2026-10-06",
  "dateTimeUtc": "2026-10-06T14:30:00.000Z",
  "dateTimeOffset": "2026-10-06T09:30:00-05:00",
  "zeroPaddedId": "00123",
  "numberAsString": "9007199254740993",
  "nothing": null,
  "no": false,
  "emptyObject": {},
  "emptyArray": [],
  "nested": [[[]], [{}], [null]],
  "accents": "ñandú — Ñuñoa",
  "cjk": "漢字",
  "emoji": "🦊 👨‍👩‍👧",
  "escapes": "quote\" backslash\\ tab\t newline\n nul\u0000 line-separator\u2028",
  "markup": "</script><b>&amp;",
  "order": { "z": 1, "a": 2, "m": 3 },
  "__proto__": { "ownKey": true }
}`

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'laqi-fidelity-'))
  mkdirSync(join(root, 'laqi'))
  writeFileSync(
    join(root, 'laqi', 'api.json'),
    `{
  "GET /fidelity": { "default": "ok", "responses": { "ok": { "status": 200, "body": ${BODY} } } },
  "GET /a-string": { "default": "ok", "responses": { "ok": { "status": 200, "body": "just text" } } },
  "GET /a-number": { "default": "ok", "responses": { "ok": { "status": 200, "body": 42 } } },
  "GET /a-null": { "default": "ok", "responses": { "ok": { "status": 200, "body": null } } },
  "GET /a-false": { "default": "ok", "responses": { "ok": { "status": 200, "body": false } } },
  "GET /an-array": { "default": "ok", "responses": { "ok": { "status": 200, "body": [1, "two", null] } } },
  "GET /big-id": { "default": "ok", "responses": { "ok": { "status": 200, "body": { "id": 1234567890123456789 } } } }
}
`,
    'utf8',
  )
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function serve() {
  const loaded = loadMocks({ root, dir: 'laqi', file: 'laqi.json' })
  const { table } = buildRouteTable(loaded.endpoints)
  const app = createMockApp({
    table,
    scenarios: loaded.scenarios,
    getState: () => ({ scenario: null, overrides: {} }),
    cors: '*',
  })
  return { app, loaded }
}

async function fetchText(path: string) {
  const res = await serve().app.request(path)
  return { res, text: await res.text() }
}

describe('a hand-written body reaches the client as written', () => {
  it('parses on the client to exactly the value the file holds', async () => {
    const { res, text } = await fetchText('/fidelity')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/^application\/json/)
    expect(JSON.parse(text)).toStrictEqual(JSON.parse(BODY))
  })

  it('keeps dates as the exact text written, offset and all, never converted', async () => {
    const body = JSON.parse((await fetchText('/fidelity')).text)
    expect(body.date).toBe('2026-10-06')
    expect(body.dateTimeUtc).toBe('2026-10-06T14:30:00.000Z')
    expect(body.dateTimeOffset).toBe('2026-10-06T09:30:00-05:00')
    expect(body.epochMillis).toBe(1791295800000)
  })

  it('keeps numbers at full double precision, and strings that look like numbers as strings', async () => {
    const body = JSON.parse((await fetchText('/fidelity')).text)
    expect(body.safeInteger).toBe(Number.MAX_SAFE_INTEGER)
    expect(body.money).toBe(19.99)
    expect(body.floatNoise).toBe(0.1 + 0.2)
    expect(body.tiniest).toBe(Number.MIN_VALUE)
    expect(body.zeroPaddedId).toBe('00123')
    expect(body.numberAsString).toBe('9007199254740993')
  })

  it('keeps every character, including emoji sequences and the escapes JSON allows', async () => {
    const body = JSON.parse((await fetchText('/fidelity')).text)
    expect(body.emoji).toBe('🦊 👨‍👩‍👧')
    expect(body.escapes).toBe('quote" backslash\\ tab\t newline\n nul\u0000 line-separator\u2028')
    expect(body.markup).toBe('</script><b>&amp;')
  })

  it('keeps key order, and a "__proto__" key as plain data', async () => {
    const { text } = await fetchText('/fidelity')
    const body = JSON.parse(text)
    expect(Object.keys(body.order)).toEqual(['z', 'a', 'm'])
    expect(Object.hasOwn(body, '__proto__')).toBe(true)
    expect(text).toContain('"__proto__":{"ownKey":true}')
  })

  it('serves a body that is not an object as the JSON value it is', async () => {
    expect((await fetchText('/a-string')).text).toBe('"just text"')
    expect((await fetchText('/a-number')).text).toBe('42')
    expect((await fetchText('/a-null')).text).toBe('null')
    expect((await fetchText('/a-false')).text).toBe('false')
    expect((await fetchText('/an-array')).text).toBe('[1,"two",null]')
  })
})

// The one thing JSON can say that JavaScript cannot carry. laqi cannot serve
// the written digits, so it must never do it silently: the load reports the
// number, what clients get instead, and how to keep it exact.
describe('an integer past 2^53', () => {
  it('is served as JavaScript reads it, and the load says so', async () => {
    const { app, loaded } = serve()
    const text = await (await app.request('/big-id')).text()

    expect(text).toBe('{"id":1234567890123456800}')
    expect(loaded.errors).toHaveLength(1)
    expect(loaded.errors[0]!.message).toContain('1234567890123456789')
    expect(loaded.errors[0]!.message).toContain('"1234567890123456789"')
  })
})
