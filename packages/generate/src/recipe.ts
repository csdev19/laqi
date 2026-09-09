import { primitive, type PrimitiveType, type Shape, validateShape } from './shape'

/**
 * The on-disk, deliberately non-human-facing form of a Shape.
 *
 * This is generation metadata, not a contract language. Its short tags make
 * it practical to keep beside a mock, while the in-memory Shape stays the
 * clear representation used by generators and exporters.
 */
export type PackedShape =
  | 's'
  | 'n'
  | 'i'
  | 'b'
  | 'z'
  | 'd'
  | 'u'
  | ['o', [string, 0 | 1, PackedShape][]]
  | ['a', PackedShape]
  | ['t', PackedShape[]]
  | ['r', PackedShape]
  | ['l', (string | number | boolean)[]]

const primitiveCodes: Record<PrimitiveType, PackedShape> = {
  string: 's',
  number: 'n',
  integer: 'i',
  boolean: 'b',
  null: 'z',
  date: 'd',
}

const codePrimitives: Record<string, PrimitiveType | undefined> = {
  s: 'string',
  n: 'number',
  i: 'integer',
  b: 'boolean',
  z: 'null',
  d: 'date',
}

/** Encode a Shape for a mock file. The result is plain JSON. */
export function packShape(shape: Shape): PackedShape {
  switch (shape.kind) {
    case 'primitive':
      return primitiveCodes[shape.type]
    case 'unknown':
      return 'u'
    case 'object': {
      const fields: [string, 0 | 1, PackedShape][] = shape.fields.map((field) => [
        field.name,
        field.optional ? 1 : 0,
        packShape(field.shape),
      ])
      return ['o', fields]
    }
    case 'array':
      return ['a', packShape(shape.items)]
    case 'tuple':
      return ['t', shape.items.map(packShape)]
    case 'record':
      return ['r', packShape(shape.values)]
    case 'literals':
      return ['l', shape.values]
  }
}

export type UnpackShapeResult = { ok: true; shape: Shape } | { ok: false; error: string }

/**
 * Decode untrusted JSON from a mock file. Keeping this boundary explicit
 * means a hand-edited recipe can never reach generate() unchecked.
 */
export function unpackShape(value: unknown): UnpackShapeResult {
  try {
    const shape = decode(value)
    const error = validateShape(shape)
    return error ? { ok: false, error } : { ok: true, shape }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

function decode(value: unknown): Shape {
  if (typeof value === 'string') {
    if (value === 'u') return { kind: 'unknown' }
    const type = codePrimitives[value]
    if (type) return primitive(type)
    throw new Error(`unknown recipe primitive ${JSON.stringify(value)}`)
  }

  if (!Array.isArray(value) || typeof value[0] !== 'string') {
    throw new Error('recipe nodes must be a tag or tagged array')
  }

  switch (value[0]) {
    case 'o': {
      if (!Array.isArray(value[1]) || value.length !== 2)
        throw new Error('object recipe needs fields')
      return {
        kind: 'object',
        fields: value[1].map((field, index) => {
          if (!Array.isArray(field) || field.length !== 3 || typeof field[0] !== 'string') {
            throw new Error(`object recipe field ${index} is invalid`)
          }
          if (field[1] !== 0 && field[1] !== 1)
            throw new Error(`object recipe field ${field[0]} has invalid optionality`)
          return { name: field[0], optional: field[1] === 1, shape: decode(field[2]) }
        }),
      }
    }
    case 'a':
      if (value.length !== 2) throw new Error('array recipe needs its item shape')
      return { kind: 'array', items: decode(value[1]) }
    case 't':
      if (!Array.isArray(value[1]) || value.length !== 2)
        throw new Error('tuple recipe needs its items')
      return { kind: 'tuple', items: value[1].map(decode) }
    case 'r':
      if (value.length !== 2) throw new Error('record recipe needs its value shape')
      return { kind: 'record', values: decode(value[1]) }
    case 'l':
      if (!Array.isArray(value[1]) || value.length !== 2)
        throw new Error('literal recipe needs values')
      if (!value[1].every((item) => ['string', 'number', 'boolean'].includes(typeof item))) {
        throw new Error('literal recipe values must be string, number or boolean')
      }
      return { kind: 'literals', values: value[1] as (string | number | boolean)[] }
    default:
      throw new Error(`unknown recipe tag ${JSON.stringify(value[0])}`)
  }
}
