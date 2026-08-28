import { describe, expect, it } from 'vitest'
import { displayWidth } from './layout'
import { formatDuration, goodbyeScreen, startScreen } from './screens'

/** Not exported from the package on purpose — tests strip escapes locally. */
function strip(text: string): string {
  // eslint-disable-next-line no-control-regex -- matching the ESC byte paint() emits is the point
  return text.replace(/\x1b\[[0-9;]*m/g, '')
}

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

  // The header is `paint()`ed before `rule()` measures it. Level 'none'
  // never exercises that path -- `paint()` is a no-op there -- so the rule
  // can be silently broken on every real terminal while this suite stayed
  // green.
  for (const level of ['truecolor', 'ansi256'] as const) {
    it(`renders the rule at exactly the requested width at ${level}`, () => {
      const out = startScreen(start, level, 72)
      expect(out).toContain('\u2500')
      const header = strip(out).split('\n')[1] ?? ''
      expect(displayWidth(header)).toBe(72)
    })
  }
})

describe('goodbyeScreen', () => {
  const goodbye = {
    upMs: 41 * 60_000,
    requests: 218,
    unmatched: 9,
    flips: 12,
    filesWritten: [{ file: 'laqi/api.json', times: 1 }],
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

  // Same guard as startScreen's: level 'none' never exercises the painted
  // path rule() actually measures in real use.
  for (const level of ['truecolor', 'ansi256'] as const) {
    it(`renders the rule at exactly the requested width at ${level}`, () => {
      const out = goodbyeScreen(goodbye, level, 72)
      expect(out).toContain('\u2500')
      const header = strip(out).split('\n')[1] ?? ''
      expect(displayWidth(header)).toBe(72)
    })
  }
})
