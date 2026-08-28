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
 * `left ─────── right`, filling to exactly `width`. One rule carries the eye
 * from the name to the timing; no box drawing, which wraps badly and ages
 * poorly.
 */
export function rule(left: string, right: string, width: number, level: Level): string {
  const fill = width - left.length - right.length - 2
  if (fill < 1) return `${left} ${right}`
  return `${left} ${paint('─'.repeat(fill), 'dim', level)} ${right}`
}

/** A dim label in a fixed column, then a bright value. */
export function row(label: string, value: string, level: Level): string {
  const padded = label.length >= LABEL_WIDTH ? `${label} ` : label.padEnd(LABEL_WIDTH)
  return `${paint(padded, 'label', level)}${value}`
}
