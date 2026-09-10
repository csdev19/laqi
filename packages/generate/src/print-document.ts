import { fieldTypeName, property, singular } from './print-shape'

/**
 * A stored JSON Schema document → TypeScript, in the document's own order.
 *
 * quicktype prints the other export languages and alphabetises properties
 * whenever its input is a JSON Schema. For a language you are translating
 * INTO that is cosmetic. TypeScript is not a translation here: it is the
 * language a laqi schema is written in and read back from, so what it prints
 * has to be what a person would have written — keys where the schema has
 * them, `$defs` kept under their own names.
 *
 * Covers exactly the vocabulary the compiler accepts, and nothing more: a
 * keyword the generator would refuse is not one this should quietly render.
 */
export function printDocumentTypeScript(
  document: Record<string, unknown>,
  typeName: string,
): string {
  const defs = isObject(document['$defs']) ? document['$defs'] : {}
  const declarations: string[] = []
  const taken = new Set<string>()
  /** `$defs` key → the declaration name it was given. */
  const named = new Map<string, string>()

  const uniqueName = (preferred: string): string => {
    let name = preferred
    let suffix = 2
    while (taken.has(name)) name = `${preferred}${suffix++}`
    taken.add(name)
    return name
  }

  /** An object becomes a named interface; anything else a type alias. */
  const declare = (name: string, node: Record<string, unknown>): void => {
    const slot = declarations.push('') - 1
    if (isPlainObject(node)) {
      declarations[slot] = `export interface ${name} {\n${fields(node).join('\n')}\n}`
    } else {
      declarations[slot] = `export type ${name} = ${type(node, name)};`
    }
  }

  const fields = (node: Record<string, unknown>): string[] => {
    const properties = isObject(node['properties']) ? node['properties'] : {}
    const required = new Set(Array.isArray(node['required']) ? node['required'] : [])
    return Object.entries(properties).map(
      ([key, schema]) =>
        `  ${property(key)}${required.has(key) ? '' : '?'}: ${type(schema, fieldTypeName(key))};`,
    )
  }

  /** The TypeScript for one schema node, declaring what it has to along the way. */
  const type = (schema: unknown, preferred: string): string => {
    if (schema === true) return 'unknown'
    if (schema === false) return 'never'
    if (!isObject(schema)) return 'unknown'

    const ref = schema['$ref']
    if (typeof ref === 'string') return reference(ref)

    if (Array.isArray(schema['enum'])) return literals(schema['enum'])
    if ('const' in schema) return literals([schema['const']])

    for (const keyword of ['anyOf', 'oneOf'] as const) {
      const branches = schema[keyword]
      if (Array.isArray(branches)) {
        return branches.map((branch) => parenthesised(type(branch, preferred))).join(' | ')
      }
    }
    const all = schema['allOf']
    if (Array.isArray(all)) {
      return all.map((branch) => parenthesised(type(branch, preferred))).join(' & ')
    }

    const declared = schema['type']
    const types = Array.isArray(declared) ? declared : declared === undefined ? [] : [declared]
    if (types.length === 0) return 'unknown'
    return types.map((one) => single(String(one), schema, preferred)).join(' | ')
  }

  const single = (kind: string, schema: Record<string, unknown>, preferred: string): string => {
    switch (kind) {
      case 'object': {
        if (isPlainObject(schema)) {
          const name = uniqueName(preferred)
          declare(name, schema)
          return name
        }
        // No properties: a map. Its value type is whatever `additionalProperties` allows.
        const values = schema['additionalProperties']
        return `Record<string, ${values === undefined || values === true ? 'unknown' : type(values, singular(preferred))}>`
      }
      case 'array': {
        const prefix = schema['prefixItems']
        if (Array.isArray(prefix)) {
          return `[${prefix.map((item, index) => type(item, `${preferred}${index + 1}`)).join(', ')}]`
        }
        const items = schema['items']
        const item = items === undefined ? 'unknown' : type(items, singular(preferred))
        return item.includes(' | ') ? `(${item})[]` : `${item}[]`
      }
      case 'string':
        return schema['format'] === 'date-time' ? 'Date' : 'string'
      case 'integer':
      case 'number':
        return 'number'
      case 'boolean':
        return 'boolean'
      case 'null':
        return 'null'
      default:
        return 'unknown'
    }
  }

  /**
   * `#/$defs/X` prints as X's declaration name. Declared on first use, so a
   * component two fields share is one interface referenced twice — which is
   * what the source said, and what a reader expects from a shared component.
   */
  const reference = (ref: string): string => {
    const prefix = '#/$defs/'
    if (!ref.startsWith(prefix)) return 'unknown'
    const key = ref.slice(prefix.length)
    const known = named.get(key)
    if (known !== undefined) return known
    const target = defs[key]
    if (!isObject(target)) return 'unknown'
    const name = uniqueName(fieldTypeName(key))
    named.set(key, name)
    declare(name, target)
    return name
  }

  const rootName = uniqueName(typeName)
  declare(rootName, document)
  return `${declarations.join('\n\n')}\n`
}

/** An object schema with properties: an interface. Without them it is a map. */
function isPlainObject(node: Record<string, unknown>): boolean {
  const declared = node['type']
  const types = Array.isArray(declared) ? declared : [declared]
  return types.includes('object') && isObject(node['properties']) && !('$ref' in node)
}

function literals(values: unknown[]): string {
  return values.map((value) => JSON.stringify(value)).join(' | ')
}

/** A union inside a union or an array keeps its own parentheses. */
function parenthesised(text: string): string {
  return text.includes(' | ') || text.includes(' & ') ? `(${text})` : text
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
