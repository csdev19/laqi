import { describe, expect, it } from 'vitest'
import { formatDuration, goodbyeScreen, startScreen } from './screens'

const start = {
  version: '2.0.1',
  servingUrl: 'http://127.0.0.1:8000',
  panelUrl: 'http://127.0.0.1:8000/__laqi',
  watching: './laqi/',
  endpoints: 7,
  responses: 19,
  scenarios: 4,
  bootMs: 84,
}

describe('formatDuration', () => {
  it('reads in the largest unit that stays honest', () => {
    expect(formatDuration(84)).toBe('84ms')
    expect(formatDuration(1_500)).toBe('1.5s')
    expect(formatDuration(41 * 60_000)).toBe('41m')
    expect(formatDuration(3 * 3_600_000)).toBe('3h 0m')
  })
})

describe('startScreen', () => {
  it('names the version and the boot time on the rule', () => {
    const out = startScreen(start, 'none', 72)
    expect(out).toContain('laqi 2.0.1')
    expect(out).toContain('ready in 84ms')
  })

  // The panel is the feature laqi is built around and today's banner omits it.
  it('shows the panel URL', () => {
    expect(startScreen(start, 'none', 72)).toContain('http://127.0.0.1:8000/__laqi')
  })

  // Today's line says only how many endpoints loaded, which does not tell you
  // whether the scenarios file was picked up at all.
  it('counts responses and scenarios, not just endpoints', () => {
    const out = startScreen(start, 'none', 72)
    expect(out).toContain('7 endpoints · 19 responses · 4 scenarios')
  })

  it('singularises a lone endpoint', () => {
    const out = startScreen({ ...start, endpoints: 1, responses: 1, scenarios: 0 }, 'none', 72)
    expect(out).toContain('1 endpoint · 1 response')
    expect(out).not.toContain('scenarios')
  })

  it('stays clean of escape codes at level none', () => {
    const testStr = '\u001b['
    expect(startScreen(start, 'none', 72)).not.toContain(testStr)
  })
})

describe('goodbyeScreen', () => {
  const goodbye = {
    upMs: 41 * 60_000,
    requests: 218,
    unmatched: 9,
    flips: 12,
    filesWritten: ['laqi/api.json'],
  }

  it('reports the session in one block', () => {
    const out = goodbyeScreen(goodbye, 'none', 72)
    expect(out).toContain('laqi stopped')
    expect(out).toContain('up 41m')
    expect(out).toContain('218 requests · 9 unmatched')
  })

  it('carries the farewell', () => {
    expect(goodbyeScreen(goodbye, 'none', 72)).toContain('tupananchikkama — until we meet again')
  })

  it('omits the files row when nothing was written', () => {
    const out = goodbyeScreen({ ...goodbye, filesWritten: [] }, 'none', 72)
    expect(out).not.toContain('files')
  })
})
