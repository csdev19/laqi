import { describe, expect, it } from 'vitest'
import { GLYPH, renderFailure } from './report'

const portInUse = {
  severity: 'fatal',
  headline: 'laqi could not start',
  cause: 'Port 8000 is already in use.',
  remedy: ['laqi start --port 8001', 'kill $(lsof -ti :8000)'],
  outcome: 'nothing was started · exit 3',
} as const

describe('renderFailure', () => {
  it('renders the five parts in order', () => {
    const out = renderFailure(portInUse, 'none')
    const lines = out.split('\n').filter((l) => l.trim() !== '')

    expect(lines[0]).toBe('✗ laqi could not start')
    expect(lines[1]?.trim()).toBe('Port 8000 is already in use.')
    expect(lines[2]?.trim()).toBe('try   laqi start --port 8001')
    expect(lines[3]?.trim()).toBe('or    kill $(lsof -ti :8000)')
    expect(lines[4]?.trim()).toBe('nothing was started · exit 3')
  })

  it('gives each severity its own glyph', () => {
    expect(GLYPH.fatal).toBe('✗')
    expect(GLYPH.degraded).toBe('!')
    expect(GLYPH.notice).toBe('•')
    expect(GLYPH.recovered).toBe('↻')
  })

  it('renders file:line:col when there is evidence', () => {
    const out = renderFailure(
      { ...portInUse, evidence: { file: 'laqi/api.json', line: 14, col: 7 } },
      'none',
    )
    expect(out).toContain('laqi/api.json:14:7')
  })

  it('omits the column when only a line is known', () => {
    const out = renderFailure(
      { ...portInUse, evidence: { file: 'laqi/api.json', line: 14 } },
      'none',
    )
    expect(out).toContain('laqi/api.json:14')
    expect(out).not.toContain(':14:')
  })

  // A degraded failure is the one that has to read as survivable, because it is.
  it('renders a degraded failure without a remedy', () => {
    const out = renderFailure(
      {
        severity: 'degraded',
        headline: 'laqi/api.json is not valid JSON',
        cause: 'A trailing comma leaves one closing brace too many.',
        outcome: 'still serving the 6 endpoints that loaded · save the file to retry',
      },
      'none',
    )
    expect(out.split('\n')[0]).toBe('! laqi/api.json is not valid JSON')
    // No remedy block: assert on the labels, not on a bare substring —
    // the outcome legitimately contains the word "retry".
    const labels = out.split('\n').map((line) => line.trim())
    expect(labels.some((line) => line.startsWith('try '))).toBe(false)
    expect(labels.some((line) => line.startsWith('or '))).toBe(false)
    expect(out).toContain('still serving the 6 endpoints that loaded')
  })

  it('adds no escape codes at level none', () => {
    expect(renderFailure(portInUse, 'none')).not.toContain('[')
  })

  it('colours the glyph by severity when colour is on', () => {
    expect(renderFailure(portInUse, 'truecolor')).toContain('[38;2;255;0;88m')
  })
})
