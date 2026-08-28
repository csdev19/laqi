import { LABEL_WIDTH, row, rule, usableWidth } from './layout'
import { paint, type Level } from './palette'

export type StartInfo = {
  version: string
  servingUrl: string
  panelUrl: string
  watching: string
  endpoints: number
  responses: number
  scenarios: number
  bootMs: number
}

export type GoodbyeInfo = {
  upMs: number
  requests: number
  unmatched: number
  flips: number
  filesWritten: readonly string[]
}

const BOLT = '⚡'

export function formatDuration(ms: number): string {
  if (ms < 1_000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)}s`
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`
  const hours = Math.floor(ms / 3_600_000)
  return `${hours}h ${Math.round((ms - hours * 3_600_000) / 60_000)}m`
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

export function startScreen(info: StartInfo, level: Level, columns?: number): string {
  const width = usableWidth(columns)

  const counts = [plural(info.endpoints, 'endpoint'), plural(info.responses, 'response')]
  // A zero here means the scenarios file is missing or empty, which is worth
  // noticing by its absence rather than reading as "0 scenarios".
  if (info.scenarios > 0) counts.push(plural(info.scenarios, 'scenario'))

  return [
    '',
    rule(
      `${paint(BOLT, 'bolt', level)} ${paint(`laqi`, 'value', level)} ${paint(info.version, 'dim', level)}`,
      paint(`ready in ${formatDuration(info.bootMs)}`, 'dim', level),
      width,
      level,
    ),
    '',
    row('serving', paint(info.servingUrl, 'accent', level), level),
    row('panel', paint(info.panelUrl, 'accent', level), level),
    row(
      'watching',
      `${paint(info.watching, 'value', level)} ${paint(counts.join(' · '), 'dim', level)}`,
      level,
    ),
    '',
  ].join('\n')
}

export function goodbyeScreen(info: GoodbyeInfo, level: Level, columns?: number): string {
  const width = usableWidth(columns)

  const lines = [
    '',
    rule(
      `${paint(BOLT, 'bolt', level)} ${paint('laqi stopped', 'value', level)}`,
      paint(`up ${formatDuration(info.upMs)}`, 'dim', level),
      width,
      level,
    ),
    '',
    row(
      'served',
      `${paint(plural(info.requests, 'request'), 'value', level)} ${paint(`· ${info.unmatched} unmatched`, 'dim', level)}`,
      level,
    ),
    row('flipped', paint(plural(info.flips, 'time'), 'value', level), level),
  ]

  if (info.filesWritten.length > 0) {
    lines.push(row('files', paint(info.filesWritten.join(', '), 'value', level), level))
  }

  lines.push(
    '',
    `${' '.repeat(LABEL_WIDTH)}${paint('tupananchikkama', 'bolt', level)} ${paint('— until we meet again', 'dim', level)}`,
    '',
  )

  return lines.join('\n')
}
