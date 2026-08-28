import { paint, type Level } from './palette'

/** Wide enough for `watching` plus a space; the URLs stack flush against it. */
export const LABEL_WIDTH = 12

/** Below this the rule has no room and degrades to a plain join. */
export const MIN_WIDTH = 48

const DEFAULT_WIDTH = 80

export function usableWidth(columns: number | undefined): number {
  if (columns === undefined) return DEFAULT_WIDTH
  return Math.max(columns, MIN_WIDTH)
}

/**
 * Count display columns, not UTF-16 code units. Wide characters (emoji,
 * CJK) that render as two columns are counted as 2. Everything else is 1.
 *
 * This is deliberately not a full East Asian Width implementation. It covers:
 * - CJK Unified Ideographs, Bopomofo, Hiragana, Katakana, Hangul, and
 *   compatibility forms (U+1100–U+115F, U+2E80–U+A4CF, U+AC00–U+D7A3,
 *   U+F900–U+FAFF, U+FE30–U+FE6F, U+FF00–U+FF60, U+FFE0–U+FFE6)
 * - Emoji (U+1F300–U+1F9FF)
 * - Miscellaneous Symbols and Dingbats including the bolt (U+2600–U+27BF)
 *
 * Callers hitting characters outside these ranges will count them as 1,
 * which is the safe assumption for most scripts. The function iterates code
 * points with `for (const ch of text)` to handle surrogate pairs correctly.
 */
export function displayWidth(text: string): number {
  let width = 0
  for (const ch of text) {
    const code = ch.codePointAt(0)!
    // CJK and fullwidth forms
    if (
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe30 && code <= 0xfe6f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) ||
      // Emoji planes
      (code >= 0x1f300 && code <= 0x1f9ff) ||
      // Miscellaneous Symbols and Dingbats (includes the bolt)
      (code >= 0x2600 && code <= 0x27bf)
    ) {
      width += 2
    } else {
      width += 1
    }
  }
  return width
}

/**
 * `left ─────── right`, filling to exactly `width`. One rule carries the eye
 * from the name to the timing; no box drawing, which wraps badly and ages
 * poorly.
 */
export function rule(left: string, right: string, width: number, level: Level): string {
  const fill = width - displayWidth(left) - displayWidth(right) - 2
  if (fill < 1) return `${left} ${right}`
  return `${left} ${paint('─'.repeat(fill), 'dim', level)} ${right}`
}

/** A dim label in a fixed column, then a bright value. */
export function row(label: string, value: string, level: Level): string {
  const labelWidth = displayWidth(label)
  const padded =
    labelWidth >= LABEL_WIDTH ? `${label} ` : label + ' '.repeat(LABEL_WIDTH - labelWidth)
  return `${paint(padded, 'label', level)}${value}`
}
