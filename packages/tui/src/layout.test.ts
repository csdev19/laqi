import { describe, expect, it } from 'vitest'
import { LABEL_WIDTH, MIN_WIDTH, displayWidth, row, rule, usableWidth } from './layout'

describe('rule', () => {
  it('fills the space between the two ends so the line is exactly the width', () => {
    const out = rule('laqi 2.0.1', 'ready in 84ms', 60, 'none')
    expect(out).toHaveLength(60)
    expect(out.startsWith('laqi 2.0.1 ')).toBe(true)
    expect(out.endsWith(' ready in 84ms')).toBe(true)
    expect(out).toContain('─')
  })

  // Below the minimum the dashes would vanish and the two ends would collide.
  it('drops the fill rather than colliding the ends when there is no room', () => {
    const out = rule('laqi 2.0.1', 'ready in 84ms', 20, 'none')
    expect(out).toBe('laqi 2.0.1 ready in 84ms')
  })
})

describe('row', () => {
  it('pads the label so values stack flush', () => {
    expect(row('serving', 'http://127.0.0.1:8000', 'none')).toBe(
      'serving'.padEnd(LABEL_WIDTH) + 'http://127.0.0.1:8000',
    )
  })

  it('does not truncate a label longer than the column', () => {
    expect(row('averylonglabelindeed', 'x', 'none')).toBe('averylonglabelindeed x')
  })
})

describe('usableWidth', () => {
  it('uses the terminal width when it is comfortable', () => {
    expect(usableWidth(100)).toBe(100)
  })

  it('never goes below the minimum, however narrow the terminal claims to be', () => {
    expect(usableWidth(10)).toBe(MIN_WIDTH)
  })

  // Not a TTY, so process.stdout.columns is undefined.
  it('assumes 80 when the width is unknown', () => {
    expect(usableWidth(undefined)).toBe(80)
  })
})

describe('displayWidth', () => {
  it('counts ordinary text one column per character', () => {
    expect(displayWidth('laqi 2.0.1')).toBe(10)
  })

  // The bolt is the reason this function exists: .length says 1, the
  // terminal draws 2, and the rule's right end would hang one column past
  // every other line.
  it('counts the bolt as two columns', () => {
    expect(displayWidth('⚡')).toBe(2)
  })

  it('leaves the separator and the rule character at one column', () => {
    expect(displayWidth('·')).toBe(1)
    expect(displayWidth('─')).toBe(1)
  })

  it('counts CJK as two columns', () => {
    expect(displayWidth('日本')).toBe(4)
  })
})

describe('rule with a wide character', () => {
  it('measures the visible width, not the code-unit count', () => {
    const out = rule('⚡ laqi', 'ready', 40, 'none')
    expect(displayWidth(out)).toBe(40)
    expect(out.length).toBe(39) // one fewer code unit, because the bolt is one unit and two columns
  })
})
