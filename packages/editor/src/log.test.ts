import { describe, expect, it } from 'vitest'
import { appendLog, LOG_CAP, resolvedText, statusClass, toLogEntry } from './log'
import type { LaqiEvent, LogEntry } from './types'

const at = new Date(2026, 7, 25, 9, 4, 7)

function served(): Extract<LaqiEvent, { type: 'request' }> {
  return {
    type: 'request',
    method: 'GET',
    path: '/users/42',
    status: 200,
    ms: 3,
    endpointId: 'GET /users/:id',
    resolvedName: 'ok',
    resolvedLayer: 'default',
  }
}

function noRoute(): Extract<LaqiEvent, { type: 'request' }> {
  return { type: 'request', method: 'GET', path: '/typo', status: 404, ms: 0, endpointId: null }
}

describe('toLogEntry', () => {
  it('keeps the requested path and the endpoint that served it', () => {
    expect(toLogEntry(served(), 1, at)).toMatchObject({
      seq: 1,
      path: '/users/42',
      endpointId: 'GET /users/:id',
      resolvedName: 'ok',
      resolvedLayer: 'default',
    })
  })

  it('zero-pads the clock so the column never jitters', () => {
    expect(toLogEntry(served(), 1, at).time).toBe('09:04:07')
  })

  it('tolerates a no-route event with no resolution fields', () => {
    const entry = toLogEntry(noRoute(), 2, at)
    expect(entry.endpointId).toBeNull()
    expect(entry.resolvedName).toBe('')
    expect(entry.resolvedLayer).toBe('')
  })
})

describe('appendLog', () => {
  const entry = (seq: number): LogEntry => toLogEntry(served(), seq, at)

  it('prepends, so the newest request is on top', () => {
    const result = appendLog([entry(1)], entry(2))
    expect(result.map((e) => e.seq)).toEqual([2, 1])
  })

  it('does not mutate the array it was given', () => {
    const original = [entry(1)]
    appendLog(original, entry(2))
    expect(original).toHaveLength(1)
  })

  it('returns a new array identity even when nothing is dropped', () => {
    const original = [entry(1)]
    expect(appendLog(original, entry(2))).not.toBe(original)
  })

  it('caps the list, dropping the oldest', () => {
    const full = Array.from({ length: 3 }, (_, i) => entry(3 - i))
    const result = appendLog(full, entry(4), 3)
    expect(result.map((e) => e.seq)).toEqual([4, 3, 2])
  })

  it('defaults to a 200-entry cap', () => {
    let entries: LogEntry[] = []
    for (let i = 0; i < LOG_CAP + 25; i++) entries = appendLog(entries, entry(i))
    expect(entries).toHaveLength(LOG_CAP)
  })
})

describe('resolvedText', () => {
  it('reproduces the X-Laqi-Resolved header verbatim', () => {
    expect(resolvedText(toLogEntry(served(), 1, at))).toBe('ok (default)')
  })

  it('says no matching route instead of an empty parenthesis', () => {
    expect(resolvedText(toLogEntry(noRoute(), 1, at))).toBe('no matching route')
  })
})

describe('statusClass', () => {
  it('maps each class', () => {
    expect(statusClass(200)).toBe('ok')
    expect(statusClass(204)).toBe('ok')
    expect(statusClass(301)).toBe('redirect')
    expect(statusClass(404)).toBe('client')
    expect(statusClass(500)).toBe('server')
  })
})
