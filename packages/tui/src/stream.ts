import { displayWidth, LABEL_WIDTH, usableWidth } from './layout'
import { paint, type Level, type Token } from './palette'

export type RequestRow = {
  /** `HH:MM:SS`. Formatted by the caller, which owns the clock. */
  time: string
  method: string
  /** The requested path, not the route pattern. */
  path: string
  status: number
  resolvedName?: string
  resolvedLayer?: string
  ms: number
  /** False when no route matched — the row that catches a typo'd path. */
  matched: boolean
  /** True when the request arrived through the tunnel rather than locally. */
  viaPublic?: boolean
}

const TIME_WIDTH = 8
const METHOD_WIDTH = 6
const VIA_WIDTH = 7
const STATUS_WIDTH = 3
const RESOLVED_WIDTH = 22
const MS_WIDTH = 6
/** One space between each of the seven columns. */
const GAPS = 6

/** The same four classes the panel paints with, mapped onto terminal tokens. */
function statusToken(status: number, matched: boolean): Token {
  if (!matched) return 'degraded'
  if (status >= 500) return 'fatal'
  if (status >= 400) return 'degraded'
  return 'recovered'
}

const padEnd = (text: string, width: number) =>
  text + ' '.repeat(Math.max(0, width - displayWidth(text)))

const padStart = (text: string, width: number) =>
  ' '.repeat(Math.max(0, width - displayWidth(text))) + text

/**
 * Truncated with an ellipsis rather than wrapped: the path is the only
 * unbounded field here, and a wrapped row destroys the column alignment
 * that makes the stream scannable in the first place.
 */
function clamp(text: string, width: number): string {
  if (width <= 1) return ''
  return displayWidth(text) <= width ? text : `${text.slice(0, width - 1)}…`
}

/**
 * One request, one line. Same fields in the same order as the panel's log
 * row, so the two surfaces read as one product.
 */
export function requestRow(row: RequestRow, level: Level, columns?: number): string {
  const width = usableWidth(columns)

  const fixed =
    TIME_WIDTH + METHOD_WIDTH + VIA_WIDTH + STATUS_WIDTH + RESOLVED_WIDTH + MS_WIDTH + GAPS
  const pathWidth = Math.max(8, width - fixed)

  const resolved = row.matched
    ? `${row.resolvedName ?? ''} · ${row.resolvedLayer ?? ''}`
    : 'no matching route'

  return [
    paint(padEnd(row.time, TIME_WIDTH), 'dim', level),
    paint(padEnd(row.method, METHOD_WIDTH), 'value', level),
    paint(padEnd(clamp(row.path, pathWidth), pathWidth), 'value', level),
    // Blank, not omitted: the column has to hold its place, or every row
    // after the first public request shifts sideways.
    paint(padEnd(row.viaPublic === true ? 'public' : '', VIA_WIDTH), 'accent', level),
    paint(padStart(String(row.status), STATUS_WIDTH), statusToken(row.status, row.matched), level),
    paint(padEnd(clamp(resolved, RESOLVED_WIDTH), RESOLVED_WIDTH), 'dim', level),
    paint(padStart(`${row.ms}ms`, MS_WIDTH), 'dim', level),
  ].join(' ')
}

/**
 * The line stage 1 could not print, because none of these keys were bound.
 * Indented to the start screen's value column so the two blocks align.
 */
export function keysLine(level: Level, sharing: boolean): string {
  const keys: [string, string][] = [
    ['o', 'panel'],
    // The label says which way the toggle will go. A fixed "share" while a
    // tunnel is already open tells you to do what you have just done.
    ['s', sharing ? 'stop sharing' : 'share'],
    ['c', 'clear'],
    ['q', 'quit'],
  ]

  return (
    ' '.repeat(LABEL_WIDTH) +
    keys
      .map(([key, label]) => `${paint(key, 'value', level)} ${paint(label, 'dim', level)}`)
      .join(paint(' · ', 'dim', level))
  )
}
