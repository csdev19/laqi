export type Position = { line: number; col: number }

export type JsonParseResult =
  | { ok: true; value: unknown }
  | { ok: false; message: string; line: number; col: number; excerpt: string }

/** Converts a character offset to a 1-based line/column. */
export function offsetToPosition(source: string, offset: number): Position {
  const clamped = Math.max(0, Math.min(offset, source.length))
  let line = 1
  let lastBreak = -1

  for (let i = 0; i < clamped; i++) {
    if (source[i] === '\n') {
      line++
      lastBreak = i
    }
  }

  return { line, col: clamped - lastBreak }
}

/**
 * Three lines of context with a caret under the failing column.
 * The panel's error banner (F8) consumes this format as-is.
 */
export function buildExcerpt(source: string, line: number, col: number): string {
  const lines = source.split('\n')
  const first = Math.max(1, line - 2)
  const last = Math.min(lines.length, line + 1)
  const gutter = String(last).length

  const rendered: string[] = []
  for (let n = first; n <= last; n++) {
    rendered.push(`${String(n).padStart(gutter)} | ${lines[n - 1] ?? ''}`)
    if (n === line) {
      rendered.push(`${' '.repeat(gutter)} | ${' '.repeat(Math.max(0, col - 1))}^`)
    }
  }

  return rendered.join('\n')
}

/**
 * V8 (Node) includes the position in the message — old format `at position N`
 * and new format `(line N column N)`. JavaScriptCore (Bun) includes neither.
 * The published CLI runs on Node, so production always has a position; under
 * Bun (development) it degrades to line 1 with the full message.
 */
const OFFSET_PATTERN = /at position (\d+)/
const LINE_COL_PATTERN = /\(line (\d+) column (\d+)\)/

export function parseJsonWithPosition(source: string): JsonParseResult {
  try {
    return { ok: true, value: JSON.parse(source) as unknown }
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error)

    const lineCol = LINE_COL_PATTERN.exec(raw)
    const { line, col } = lineCol
      ? { line: Number(lineCol[1]), col: Number(lineCol[2]) }
      : offsetToPosition(source, Number(OFFSET_PATTERN.exec(raw)?.[1] ?? 0))

    return {
      ok: false,
      // We strip the position suffix: the line and column go in their own fields.
      message: raw.replace(/\s*in JSON at position \d+.*$/, '').trim() || raw,
      line,
      col,
      excerpt: buildExcerpt(source, line, col),
    }
  }
}
