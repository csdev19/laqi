/**
 * The layout laqi writes mock files in.
 *
 * `JSON.stringify(value, null, 2)` puts every array element on its own line,
 * which turns a schema document's `required` and `enum` lists — most of its
 * lines — into vertical noise nobody reads. This keeps those on one line
 * while leaving everything else expanded, so a diff still shows one change
 * per line.
 *
 * Layout only. What is written parses back to exactly what
 * `JSON.stringify` would have produced, which is why the value is
 * round-tripped through it first: `toJSON`, dropped `undefined` members and
 * non-finite numbers are then settled by the same code as before, and this
 * module decides nothing but where the newlines go.
 */
const INDENT = '  '

/** The column a complete line may reach before its array is expanded. */
export const MAX_COLUMNS = 100

type Json = null | boolean | number | string | Json[] | { [key: string]: Json }

type JsonScalar = null | boolean | number | string

const isScalar = (value: Json): value is JsonScalar => value === null || typeof value !== 'object'

export function formatJson(value: unknown): string {
  const plain = JSON.parse(JSON.stringify(value ?? null)) as Json
  return render(plain, 0, 0)
}

/**
 * @param depth how many indents deep this value sits
 * @param used  columns already spent on this line before the value starts —
 *              the indent plus any `"key": ` in front of it, plus the comma
 *              that will follow
 */
function render(value: Json, depth: number, used: number): string {
  if (isScalar(value)) return JSON.stringify(value)

  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    if (value.every(isScalar)) {
      const inline = `[${value.map((item) => JSON.stringify(item)).join(', ')}]`
      if (used + inline.length <= MAX_COLUMNS) return inline
    }
    const inner = INDENT.repeat(depth + 1)
    const items = value.map((item) => inner + render(item, depth + 1, inner.length + 1))
    return `[\n${items.join(',\n')}\n${INDENT.repeat(depth)}]`
  }

  const entries = Object.entries(value)
  if (entries.length === 0) return '{}'
  const inner = INDENT.repeat(depth + 1)
  const members = entries.map(([key, member]) => {
    const label = `${JSON.stringify(key)}: `
    return inner + label + render(member, depth + 1, inner.length + label.length + 1)
  })
  return `{\n${members.join(',\n')}\n${INDENT.repeat(depth)}}`
}
