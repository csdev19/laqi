import { offsetToPosition } from './json-position'

export type LossyNumber = {
  /** The number exactly as the file spells it. */
  written: string
  /** What a client receives after laqi parses and re-serializes it. */
  becomes: string
  line: number
  col: number
}

const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y

/**
 * Every number in a JSON text whose VALUE changes on the way through
 * JavaScript: integers past 2^53, decimals with more digits than a double
 * holds, and magnitudes a double cannot hold at all (served as `null`).
 *
 * Spelling is not value: `1.0`, `1.50`, `-0` and `1E+21` come out as `1`,
 * `1.5`, `0` and `1e+21`, which every JSON client reads as the same number,
 * so they are not reported.
 *
 * Works on the text because JSON.parse has already lost the difference by
 * the time anything else could look. Assumes the text parses; on text that
 * does not, it reports what it can and never throws.
 */
export function findLossyNumbers(source: string): LossyNumber[] {
  const found: LossyNumber[] = []

  for (let i = 0; i < source.length; i++) {
    const char = source[i]!

    if (char === '"') {
      i = endOfString(source, i)
      continue
    }
    if (char !== '-' && (char < '0' || char > '9')) continue

    NUMBER.lastIndex = i
    const match = NUMBER.exec(source)
    if (!match) continue
    const written = match[0]
    const value = Number(written)
    const becomes = Number.isFinite(value) ? String(value) : 'null'

    if (becomes === 'null' || canonical(written) !== canonical(becomes)) {
      found.push({ written, becomes, ...offsetToPosition(source, i) })
    }
    i += written.length - 1
  }

  return found
}

/** The index of the quote that closes the string opening at `start`. */
function endOfString(source: string, start: number): number {
  for (let i = start + 1; i < source.length; i++) {
    if (source[i] === '\\') i++
    else if (source[i] === '"') return i
  }
  return source.length
}

/**
 * One spelling per value: sign, significant digits, exponent. Exact, with
 * no floating point involved, so it can compare what the file says against
 * what JavaScript kept.
 */
function canonical(literal: string): string {
  const [, sign = '', whole = '', fraction = '', exponent = '0'] =
    /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(literal) ?? []

  let digits = (whole + fraction).replace(/^0+/, '')
  if (digits === '') return '0'

  let power = Number(exponent) - fraction.length
  const trailing = digits.length - digits.replace(/0+$/, '').length
  digits = digits.slice(0, digits.length - trailing)
  power += trailing

  return `${sign}${digits}e${power}`
}
