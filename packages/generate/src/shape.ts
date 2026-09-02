/**
 * The internal hub every generator arrow speaks. Deliberately minimal: it
 * only has to describe API response shapes, not all of TypeScript.
 */
export type PrimitiveType = 'string' | 'number' | 'integer' | 'boolean' | 'null' | 'date'

export type ShapeField = { name: string; shape: Shape; optional: boolean }

export type Shape =
  | { kind: 'object'; fields: ShapeField[] }
  | { kind: 'array'; items: Shape }
  | { kind: 'tuple'; items: Shape[] }
  | { kind: 'record'; values: Shape }
  | { kind: 'literals'; values: (string | number | boolean)[] }
  | { kind: 'primitive'; type: PrimitiveType }
  | { kind: 'unknown' }

export const primitive = (type: PrimitiveType): Shape => ({ kind: 'primitive', type })

/**
 * Deepest shape `validateShape` will accept. `Shape` is a TypeScript union,
 * which buys nothing at runtime — a JavaScript consumer, a future JSON
 * boundary, or a hand-built shape can hand the generators anything. This
 * ceiling matches `inferShape`'s own, the deepest shape anything in this
 * package produces.
 */
export const MAX_SHAPE_DEPTH = 500

const PRIMITIVE_TYPES = new Set<string>([
  'string',
  'number',
  'integer',
  'boolean',
  'null',
  'date',
] satisfies PrimitiveType[])

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Runtime check that a value really is a `Shape` the generators can honour.
 *
 * Returns `null` when it is, or a message naming the offending path when it
 * is not. This is the guard the type system cannot give us: the generators
 * promise plain JSON-serialisable output, and a shape the compiler never
 * saw — `{ kind: 'literals', values: [] }`, say, which would pick from an
 * empty set and yield `undefined` — silently breaks that promise.
 */
export function validateShape(value: unknown, path = '$', depth = 0): string | null {
  if (depth > MAX_SHAPE_DEPTH) {
    return `${path}: shape nests deeper than ${MAX_SHAPE_DEPTH} levels`
  }
  if (!isRecord(value)) return `${path}: expected a shape object, got ${typeof value}`

  switch (value.kind) {
    case 'object': {
      if (!Array.isArray(value.fields)) return `${path}: "object" needs a fields array`
      for (const field of value.fields) {
        if (!isRecord(field)) return `${path}: every field must be an object`
        if (typeof field.name !== 'string') return `${path}: every field needs a string name`
        if (typeof field.optional !== 'boolean') {
          return `${path}.${field.name}: "optional" must be a boolean`
        }
        const inner = validateShape(field.shape, `${path}.${field.name}`, depth + 1)
        if (inner) return inner
      }
      return null
    }
    case 'array':
      return validateShape(value.items, `${path}[]`, depth + 1)
    case 'tuple': {
      if (!Array.isArray(value.items)) return `${path}: "tuple" needs an items array`
      for (const [index, item] of value.items.entries()) {
        const inner = validateShape(item, `${path}[${index}]`, depth + 1)
        if (inner) return inner
      }
      return null
    }
    case 'record':
      return validateShape(value.values, `${path}{}`, depth + 1)
    case 'literals': {
      if (!Array.isArray(value.values)) return `${path}: "literals" needs a values array`
      // An empty union has nothing to pick from: generation would produce
      // `undefined`, which is not JSON.
      if (value.values.length === 0) return `${path}: "literals" cannot be empty`
      for (const literal of value.values) {
        const type = typeof literal
        if (type !== 'string' && type !== 'number' && type !== 'boolean') {
          return `${path}: "literals" values must be string, number or boolean — got ${type}`
        }
      }
      return null
    }
    case 'primitive':
      return typeof value.type === 'string' && PRIMITIVE_TYPES.has(value.type)
        ? null
        : `${path}: unknown primitive type ${JSON.stringify(value.type)}`
    case 'unknown':
      return null
    default:
      return `${path}: unknown shape kind ${JSON.stringify(value.kind)}`
  }
}
