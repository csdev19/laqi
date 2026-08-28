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
 * SGR colour escapes — what `paint()` wraps text in, e.g. the sequence that
 * opens a colour and the one that resets it. `screens.ts` calls `paint()`
 * before handing strings to `rule()`, so by the time width is measured the
 * text already carries these, and every byte of an unstripped escape reads
 * as a visible column: at a normal terminal width that sends `fill` negative
 * and the rule collapses entirely. Stripping lives here, not in `rule`, so
 * every future caller measuring painted text is right by default.
 */
// eslint-disable-next-line no-control-regex -- matching the ESC byte paint() emits is the point
const SGR_ESCAPE = /\x1b\[[0-9;]*m/g

/**
 * Count display columns, not UTF-16 code units. Wide characters (emoji,
 * CJK) that render as two columns are counted as 2. Everything else is 1.
 * Colour escape sequences are invisible and count as 0.
 *
 * This is deliberately not a full East Asian Width implementation. It covers:
 * - CJK Unified Ideographs, Bopomofo, Hiragana, Katakana, Hangul, and
 *   compatibility forms (U+1100–U+115F, U+2E80–U+A4CF, U+AC00–U+D7A3,
 *   U+F900–U+FAFF, U+FE30–U+FE6F, U+FF00–U+FF60, U+FFE0–U+FFE6)
 * - Emoji (U+1F300–U+1F9FF)
 * - Miscellaneous Symbols and Dingbats including the bolt (U+2600–U+27BF),
 *   except a handful of narrow glyphs the failure report uses as severity
 *   markers — checked against iTerm2, Terminal.app and Alacritty, all of
 *   which render these single-width: the check mark U+2714, the ballot X
 *   U+2717, and the warning sign U+26A0.
 *
 *   Nothing routes them through this function today (the GLYPH table's `!`,
 *   the bullet and the reload arrow all fall outside these ranges already),
 *   so this is a latent correctness fix rather than one that changes any
 *   current output.
 *
 * Callers hitting characters outside these ranges will count them as 1,
 * which is the safe assumption for most scripts. The function iterates code
 * points with `for (const ch of text)` to handle surrogate pairs correctly.
 */
export function displayWidth(text: string): number {
  let width = 0
  for (const ch of text.replace(SGR_ESCAPE, '')) {
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
      // Miscellaneous Symbols and Dingbats (includes the bolt), narrower
      // than the full block: U+2714, U+2717 and U+26A0 are excluded because
      // they render single-width — see the doc comment above.
      (code >= 0x2600 && code <= 0x27bf && code !== 0x2714 && code !== 0x2717 && code !== 0x26a0)
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
