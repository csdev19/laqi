// apps/cli/src/init/summary.ts
//
// Composes the closing screen out of the same primitives start/goodbye use
// (`rule`, `row`, `paint`, `displayWidth`) rather than hand-formatting a new
// layout. The one thing genuinely new here is the `+`/`~` change column,
// whose width depends on the paths being reported — layout.ts's fixed
// `LABEL_WIDTH` is sized for "watching", not "laqi/scenarios.json", so that
// column is computed locally the same way `rule()` computes its fill.
import { displayWidth, formatDuration, paint, row, rule, usableWidth, type Level } from '@laqi/tui'

const BOLT = '⚡'

export type InitChange = {
  /** `+` created, `~` modified — the receipt for the one intrusive change
   *  `init` can make (package.json, via --script). */
  marker: '+' | '~'
  path: string
  detail: string
}

export type InitSummaryInfo = {
  bootMs: number
  changes: readonly InitChange[]
  next: string
  /** Rendered under the `then` label — not named `then` itself, which
   *  oxlint's no-thenable rule flags on any object (it would make the
   *  object look like a Promise to an accidental `await`). */
  afterCommand: string
}

export function renderInitSummary(info: InitSummaryInfo, level: Level, columns?: number): string {
  const width = usableWidth(columns)

  const column =
    Math.max(0, ...info.changes.map((change) => displayWidth(`${change.marker} ${change.path}`))) +
    2

  const changeLines = info.changes.map((change) => {
    const left = `${change.marker} ${change.path}`
    const gap = ' '.repeat(Math.max(column - displayWidth(left), 1))
    const markerToken = change.marker === '+' ? 'accent' : 'notice'
    return `${paint(change.marker, markerToken, level)} ${paint(change.path, 'value', level)}${gap}${paint(change.detail, 'dim', level)}`
  })

  return [
    '',
    rule(
      `${paint(BOLT, 'bolt', level)} ${paint('ready', 'value', level)}`,
      paint(formatDuration(info.bootMs), 'dim', level),
      width,
      level,
    ),
    '',
    ...changeLines,
    '',
    row('next', paint(info.next, 'value', level), level),
    row('then', paint(info.afterCommand, 'value', level), level),
    '',
  ].join('\n')
}
