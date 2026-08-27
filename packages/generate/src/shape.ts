/**
 * The internal hub every generator arrow speaks. Deliberately minimal: it
 * only has to describe API response shapes, not all of TypeScript.
 */
export type PrimitiveType = 'string' | 'number' | 'integer' | 'boolean' | 'null' | 'date'

export type ShapeField = { name: string; shape: Shape; optional: boolean }

export type Shape =
  | { kind: 'object'; fields: ShapeField[] }
  | { kind: 'array'; items: Shape }
  | { kind: 'record'; values: Shape }
  | { kind: 'literals'; values: (string | number | boolean)[] }
  | { kind: 'primitive'; type: PrimitiveType }
  | { kind: 'unknown' }

export const primitive = (type: PrimitiveType): Shape => ({ kind: 'primitive', type })
