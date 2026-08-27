import type { Shape } from './shape'

/**
 * Shape → JSON Schema. This is the whole bridge to quicktype: ~40 lines in
 * exchange for 27 output languages.
 */
export function shapeToJsonSchema(shape: Shape): Record<string, unknown> {
  switch (shape.kind) {
    case 'object':
      return {
        type: 'object',
        properties: Object.fromEntries(shape.fields.map((f) => [f.name, shapeToJsonSchema(f.shape)])),
        required: shape.fields.filter((f) => !f.optional).map((f) => f.name),
        additionalProperties: false,
      }
    case 'array':
      return { type: 'array', items: shapeToJsonSchema(shape.items) }
    case 'record':
      return { type: 'object', additionalProperties: shapeToJsonSchema(shape.values) }
    case 'literals':
      return { enum: shape.values }
    case 'primitive':
      return shape.type === 'date' ? { type: 'string', format: 'date-time' } : { type: shape.type }
    case 'unknown':
      return {}
  }
}
