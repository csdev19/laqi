import { describe, expect, it } from 'vitest'
import { LABEL_WIDTH, MIN_WIDTH, displayWidth, row, rule, usableWidth } from './layout'
import { paint } from './palette'

/** Not exported from the package on purpose — tests strip escapes locally. */
function strip(text: string): string {
  // eslint-disable-next-line no-control-regex -- matching the ESC byte paint() emits is the point
  return text.replace(/\x1b\[[0-9;]*m/g, '')
}

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

  // The bug this guards: `rule()` measures strings `screens.ts` has already
  // painted. Left uncorrected, every escape byte counts as a visible column
  // and the rule collapses on any real (non-`none`) terminal.
  it('ignores colour escapes — a painted string measures the same as its plain text', () => {
    const plain = 'laqi 2.0.1'
    for (const level of ['truecolor', 'ansi256'] as const) {
      expect(displayWidth(paint(plain, 'value', level))).toBe(displayWidth(plain))
    }
  })
})

describe('rule with a wide character', () => {
  it('measures the visible width, not the code-unit count', () => {
    const out = rule('⚡ laqi', 'ready', 40, 'none')
    expect(displayWidth(out)).toBe(40)
    expect(out.length).toBe(39) // one fewer code unit, because the bolt is one unit and two columns
  })
})

describe('rule with painted ends', () => {
  // `screens.ts` never calls `rule()` with plain text — both ends are always
  // the output of `paint()`. This is the case `'none'` cannot exercise: at
  // `'none'` paint() is a no-op, so a test that only runs at that level can
  // pass while the rule is silently broken everywhere colour actually shows.
  for (const level of ['truecolor', 'ansi256'] as const) {
    it(`still renders the dash and fills to exactly the requested width at ${level}`, () => {
      const left = `${paint('⚡', 'bolt', level)} ${paint('laqi', 'value', level)} ${paint('2.0.1', 'dim', level)}`
      const right = paint('ready in 84ms', 'dim', level)
      const out = rule(left, right, 72, level)

      expect(out).toContain('─')
      expect(displayWidth(strip(out))).toBe(72)
    })
  }
})
