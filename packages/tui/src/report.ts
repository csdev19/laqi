import { paint, type Level } from './palette'

export type Severity = 'fatal' | 'degraded' | 'notice' | 'recovered'

export type Evidence = {
  file: string
  line?: number
  col?: number
  /** A short frame from the file, printed verbatim. */
  excerpt?: string
}

export type Failure = {
  severity: Severity
  /** What failed, in about six words. Never the exception class. */
  headline: string
  /** One sentence, plain words, ending in a full stop. */
  cause: string
  evidence?: Evidence
  /** At most two runnable commands. Copy-pasteable, never prose. */
  remedy?: readonly string[]
  /** Whether laqi stopped or kept serving, and the exit code. */
  outcome: string
}

export const GLYPH: Record<Severity, string> = {
  fatal: '✗',
  degraded: '!',
  notice: '•',
  recovered: '↻',
}

const INDENT = '  '

function location(evidence: Evidence): string {
  const line = evidence.line === undefined ? '' : `:${evidence.line}`
  const col = evidence.line !== undefined && evidence.col !== undefined ? `:${evidence.col}` : ''
  return `${evidence.file}${line}${col}`
}

/**
 * One shape for every failure: glyph and headline, cause, evidence, remedy,
 * outcome. A reader who has seen one has seen them all, and the outcome line
 * is what tells them whether laqi is still serving.
 */
export function renderFailure(failure: Failure, level: Level): string {
  const out: string[] = []

  out.push(`${paint(GLYPH[failure.severity], failure.severity, level)} ${failure.headline}`, '')

  if (failure.evidence !== undefined) {
    out.push(`${INDENT}${paint(location(failure.evidence), 'dim', level)}`, '')
    if (failure.evidence.excerpt !== undefined) {
      for (const line of failure.evidence.excerpt.split('\n')) out.push(`${INDENT}${line}`)
      out.push('')
    }
  }

  out.push(`${INDENT}${failure.cause}`, '')

  if (failure.remedy !== undefined && failure.remedy.length > 0) {
    const labels = ['try', 'or']
    failure.remedy.slice(0, 2).forEach((command, i) => {
      const label = (labels[i] ?? 'or').padEnd(5)
      out.push(`${INDENT}${paint(label, 'label', level)} ${paint(command, 'accent', level)}`)
    })
    out.push('')
  }

  out.push(`${INDENT}${paint(failure.outcome, 'dim', level)}`)

  return out.join('\n')
}
