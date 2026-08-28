import { describe, expect, it } from 'vitest'
import { detectLevel, paint } from './palette'

describe('detectLevel', () => {
  it('uses truecolor when the terminal advertises it', () => {
    expect(detectLevel({ COLORTERM: 'truecolor', TERM: 'xterm-256color' }, true)).toBe('truecolor')
  })

  it('falls back to 256 colours on a colour terminal that does not advertise truecolor', () => {
    expect(detectLevel({ TERM: 'xterm-256color' }, true)).toBe('ansi256')
  })

  // NO_COLOR is a cross-tool convention: any value, however empty, means off.
  it('honours NO_COLOR whatever its value', () => {
    expect(detectLevel({ NO_COLOR: '1', COLORTERM: 'truecolor' }, true)).toBe('none')
    expect(detectLevel({ NO_COLOR: '', COLORTERM: 'truecolor' }, true)).toBe('none')
  })

  it('drops colour on a dumb terminal', () => {
    expect(detectLevel({ TERM: 'dumb', COLORTERM: 'truecolor' }, true)).toBe('none')
  })

  // The case that matters most: laqi's output gets piped into CI logs and
  // captured by agents, where escape codes are noise.
  it('drops colour when stdout is not a TTY', () => {
    expect(detectLevel({ COLORTERM: 'truecolor' }, false)).toBe('none')
  })
})

describe('paint', () => {
  it('wraps text in a truecolor escape and always resets', () => {
    const out = paint('laqi', 'accent', 'truecolor')
    expect(out.startsWith('[38;2;')).toBe(true)
    expect(out.endsWith('[0m')).toBe(true)
    expect(out).toContain('laqi')
  })

  it('emits a 256-colour escape at that level', () => {
    const out = paint('laqi', 'accent', 'ansi256')
    expect(out.startsWith('[38;5;')).toBe(true)
    expect(out.endsWith('[0m')).toBe(true)
    expect(out).toContain('laqi')
  })

  // The layout has to carry the meaning on its own, which is both the
  // pipe-safety requirement and the accessibility one.
  it('returns the text untouched when there is no colour', () => {
    expect(paint('laqi', 'fatal', 'none')).toBe('laqi')
  })
})
