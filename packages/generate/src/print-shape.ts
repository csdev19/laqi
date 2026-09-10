import type { Shape } from './shape'

/**
 * A Shape → TypeScript, in the Shape's own order.
 *
 * This exists because quicktype, which prints every other language, sorts
 * properties alphabetically when its input is a JSON Schema and offers no
 * way not to. For exporting types to another language that is cosmetic. For
 * a model a person is about to accept as a response's schema it is not: the
 * schema's order becomes every generated body's order, and a body whose keys
 * come out in a different order from the sample it was built from reads as
 * "something went wrong" to the person comparing them.
 *
 * So the draft a person edits is printed here, from the shape laqi inferred,
 * with the keys where the body had them. Once accepted it is parsed back by
 * the same parser every pasted model goes through, which keeps declaration
 * order — measured, not assumed — so the order survives into the schema.
 *
 * TypeScript only, on purpose. This is not a second quicktype; it is the one
 * case where order is part of the contract.
 */
export function printShapeTypeScript(shape: Shape, typeName: string): string {
  const declarations: string[] = []
  const taken = new Set<string>()

  const uniqueName = (preferred: string): string => {
    let name = preferred
    let suffix = 2
    while (taken.has(name)) name = `${preferred}${suffix++}`
    taken.add(name)
    return name
  }

  /**
   * The TypeScript for one shape. An object becomes a named interface,
   * declared in the order it is met, depth first — so a reader finds
   * `Customer` right after the field that uses it, and the root comes first
   * because it is met first.
   */
  const type = (value: Shape, preferred: string): string => {
    switch (value.kind) {
      case 'object': {
        const name = uniqueName(preferred)
        // Reserve the slot before typing the fields, so nested interfaces
        // land after their parent rather than before it.
        const slot = declarations.push('') - 1
        const lines = value.fields.map(
          (field) =>
            `  ${property(field.name)}${field.optional ? '?' : ''}: ${type(field.shape, fieldTypeName(field.name))};`,
        )
        declarations[slot] = `export interface ${name} {\n${lines.join('\n')}\n}`
        return name
      }
      case 'array': {
        const item = type(value.items, singular(preferred))
        return needsParens(value.items) ? `(${item})[]` : `${item}[]`
      }
      case 'tuple':
        return `[${value.items.map((item, index) => type(item, `${preferred}${index + 1}`)).join(', ')}]`
      case 'record':
        return `Record<string, ${type(value.values, singular(preferred))}>`
      case 'literals':
        return value.values.map((literal) => JSON.stringify(literal)).join(' | ')
      case 'primitive':
        return PRIMITIVES[value.type]
      case 'unknown':
        return 'unknown'
    }
  }

  const root = type(shape, typeName)
  // A root that is not an object — an array of them, say — still needs a
  // declaration to import by name.
  if (shape.kind !== 'object') declarations.unshift(`export type ${typeName} = ${root};`)
  return `${declarations.join('\n\n')}\n`
}

const PRIMITIVES = {
  string: 'string',
  number: 'number',
  integer: 'number',
  boolean: 'boolean',
  null: 'null',
  date: 'Date',
} as const

/** A union inside an array needs its parentheses: `(A | B)[]`, not `A | B[]`. */
function needsParens(shape: Shape): boolean {
  return shape.kind === 'literals' && shape.values.length > 1
}

/** `customer` → `Customer`, `billing_address` → `BillingAddress`. */
export function fieldTypeName(field: string): string {
  const cleaned = field.replace(/[^A-Za-z0-9]+(.)?/g, (_, next: string | undefined) =>
    next ? next.toUpperCase() : '',
  )
  const base = cleaned.length > 0 ? cleaned : 'Field'
  return base[0]!.toUpperCase() + base.slice(1)
}

/**
 * `Lines` → `Line`, `Entries` → `Entry`. Deliberately conservative: a name
 * that does not obviously pluralise is left alone. A draft with `Status[]`
 * beats one with `Statu[]`, and the person edits it either way.
 */
export function singular(name: string): string {
  if (name.endsWith('ies') && name.length > 4) return `${name.slice(0, -3)}y`
  if (name.endsWith('ses') || name.endsWith('us') || name.endsWith('ss')) return name
  if (name.endsWith('s') && name.length > 3) return name.slice(0, -1)
  return name
}

/** Quotes a key TypeScript could not take bare. */
export function property(name: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : JSON.stringify(name)
}
