export type Position = { line: number; col: number }

export type JsonParseResult =
  | { ok: true; value: unknown }
  | { ok: false; message: string; line: number; col: number; excerpt: string }

/** Convierte un offset de caracteres en línea/columna 1-based. */
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
 * Tres líneas de contexto con un caret bajo la columna que falla.
 * El formato lo consume tal cual la banda de error del panel (F8).
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
 * V8 (Node) incluye la posición en el mensaje — formato viejo `at position N` y
 * formato nuevo `(line N column N)`. JavaScriptCore (Bun) no incluye ninguna.
 * El CLI publicado corre en Node, así que producción siempre tiene posición;
 * bajo Bun (desarrollo) se degrada a línea 1 con el mensaje completo.
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
      // Quitamos la coletilla de posición: la línea y columna van en sus campos.
      message: raw.replace(/\s*in JSON at position \d+.*$/, '').trim() || raw,
      line,
      col,
      excerpt: buildExcerpt(source, line, col),
    }
  }
}
