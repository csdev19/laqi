import { describe, expect, it } from 'vitest'
import { keysLine, requestRow, type RequestRow } from './stream'

const base: RequestRow = {
  time: '14:32:07',
  method: 'GET',
  path: '/todos',
  status: 200,
  resolvedName: 'ok',
  resolvedLayer: 'default',
  ms: 2,
  matched: true,
}

const plain = (row: Partial<RequestRow> = {}, columns = 100) =>
  requestRow({ ...base, ...row }, 'none', columns)

describe('requestRow', () => {
  it("prints the panel log's vocabulary, in the panel log's order", () => {
    expect(plain()).toMatch(/14:32:07.*GET.*\/todos.*200.*ok · default.*2ms/)
  })

  it('says what happened rather than showing a blank resolution on a no-route', () => {
    // The no-route row is the one that catches a typo'd path in the
    // frontend. An empty resolution column would bury it.
    expect(
      plain({ matched: false, status: 404, resolvedName: undefined, resolvedLayer: undefined }),
    ).toContain('no matching route')
  })

  it('never renders the string "undefined"', () => {
    expect(plain({ resolvedName: undefined, resolvedLayer: undefined, matched: false })).not.toContain(
      'undefined',
    )
  })

  it('aligns the columns across rows of different lengths', () => {
    const short = plain({ method: 'GET', path: '/a' })
    const long = plain({ method: 'DELETE', path: '/a' })
    expect(short.indexOf('/a')).toBe(long.indexOf('/a'))
  })

  it('truncates a long path instead of wrapping the row', () => {
    // A wrapped row destroys the column alignment that makes the stream
    // scannable, and the path is the only field that varies without limit.
    const row = plain({ path: `/${'x'.repeat(200)}` }, 80)
    expect(row.split('\n')).toHaveLength(1)
    expect(row).toContain('…')
  })

  it('keeps the time, status and duration even when the path is truncated', () => {
    const row = plain({ path: `/${'x'.repeat(200)}` }, 80)
    expect(row).toContain('14:32:07')
    expect(row).toContain('200')
    expect(row).toContain('2ms')
  })

  it('marks a request that arrived through the public URL', () => {
    expect(plain({ viaPublic: true })).toContain('public')
  })

  it('says nothing about the transport for a local request', () => {
    expect(plain({ viaPublic: false })).not.toContain('public')
  })

  it('keeps the columns aligned whether or not a row came in over the tunnel', () => {
    // The via column holds its place when empty, or the first public
    // request would shift every row after it sideways.
    expect(plain({ viaPublic: true }).indexOf('200')).toBe(
      plain({ viaPublic: false }).indexOf('200'),
    )
  })

  it('paints the status by class when colour is on', () => {
    // Same second scan dimension the panel uses: you find the 500 by its
    // colour before you have read the path.
    const ok = requestRow({ ...base, status: 200 }, 'truecolor', 100)
    const server = requestRow({ ...base, status: 500 }, 'truecolor', 100)
    expect(ok).not.toBe(server.replace('500', '200'))
  })

  it('emits no escape codes at level none', () => {
    expect(plain()).not.toMatch(/\u001b\[/)
  })
})

describe('keysLine', () => {
  it('names all four keys', () => {
    const line = keysLine('none', false)
    for (const key of ['o', 's', 'c', 'q']) expect(line).toContain(key)
  })

  it('reads "share" when sharing is off and "stop sharing" when it is on', () => {
    // The key toggles, so the label has to say which way it will go — a
    // fixed "share" while a tunnel is open tells you to do what you did.
    expect(keysLine('none', false)).toContain('share')
    expect(keysLine('none', true)).toContain('stop sharing')
  })

  it("indents to the start screen's value column, so the blocks line up", () => {
    expect(keysLine('none', false).startsWith(' '.repeat(12))).toBe(true)
  })
})
