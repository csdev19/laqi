import { primitive, type Shape, type ShapeField } from './shape'

/** Full-string ISO 8601: date, or date-time with optional ms and offset. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$/

/**
 * JSON → Shape. Small on purpose: this powers "give me the type of this
 * response" and "regenerate from the shape the data already has".
 */
export function inferShape(value: unknown): Shape {
  if (value === null) return primitive('null')

  switch (typeof value) {
    case 'string':
      return ISO_DATE.test(value) ? primitive('date') : primitive('string')
    case 'number':
      return Number.isInteger(value) ? primitive('integer') : primitive('number')
    case 'boolean':
      return primitive('boolean')
    case 'object':
      break
    default:
      return { kind: 'unknown' }
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return { kind: 'array', items: { kind: 'unknown' } }
    return { kind: 'array', items: value.map(inferShape).reduce(mergeShapes) }
  }

  const fields: ShapeField[] = Object.entries(value as Record<string, unknown>).map(
    ([name, field]) => ({ name, shape: inferShape(field), optional: false }),
  )
  return { kind: 'object', fields }
}

/**
 * The widening rules for array items. A field absent in some items becomes
 * optional; integer widens to number; null defers to the other side (there
 * is nothing to generate from a null); anything else that disagrees widens
 * to unknown rather than guessing.
 */
export function mergeShapes(a: Shape, b: Shape): Shape {
  if (a.kind === 'unknown') return b
  if (b.kind === 'unknown') return a
  if (a.kind === 'primitive' && a.type === 'null') return b
  if (b.kind === 'primitive' && b.type === 'null') return a

  if (a.kind === 'primitive' && b.kind === 'primitive') {
    if (a.type === b.type) return a
    const numeric = new Set(['integer', 'number'])
    if (numeric.has(a.type) && numeric.has(b.type)) return primitive('number')
    if ((a.type === 'date' && b.type === 'string') || (a.type === 'string' && b.type === 'date')) {
      return primitive('string')
    }
    return { kind: 'unknown' }
  }

  if (a.kind === 'array' && b.kind === 'array') {
    return { kind: 'array', items: mergeShapes(a.items, b.items) }
  }

  if (a.kind === 'object' && b.kind === 'object') {
    const names = [...new Set([...a.fields.map((f) => f.name), ...b.fields.map((f) => f.name)])]
    const fields: ShapeField[] = names.map((name) => {
      const left = a.fields.find((f) => f.name === name)
      const right = b.fields.find((f) => f.name === name)
      if (left && right) {
        return { name, shape: mergeShapes(left.shape, right.shape), optional: left.optional || right.optional }
      }
      const only = (left ?? right)!
      return { name, shape: only.shape, optional: true }
    })
    return { kind: 'object', fields }
  }

  return { kind: 'unknown' }
}
