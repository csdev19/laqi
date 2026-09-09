import { diagnostic, type Diagnostic } from '@laqi/schema'
import type { Plan, PlanField, PlanLiteral } from './plan'
import { MAX_SHAPE_DEPTH, type PrimitiveType } from './shape'

/**
 * Keywords that describe a document to a reader and never change what is
 * generated. They are skipped wherever they appear, and never counted as
 * unsupported.
 */
const ANNOTATIONS = new Set([
  '$schema',
  '$id',
  '$comment',
  '$defs',
  'definitions',
  'title',
  'description',
  'examples',
  'default',
  'deprecated',
  'readOnly',
  'writeOnly',
])

/** The primitive names laqi generates from, and the Shape primitive each becomes. */
const PRIMITIVES: Record<string, PrimitiveType> = {
  string: 'string',
  number: 'number',
  integer: 'integer',
  boolean: 'boolean',
  null: 'null',
}

export type CompileResult =
  | { ok: true; plan: Plan; diagnostics: Diagnostic[] }
  | { ok: false; diagnostics: Diagnostic[] }

/**
 * What every node of one compilation shares: the document `$ref` resolves
 * against, the diagnostics collected so far, and the chain of references
 * currently being followed — which is how a cycle is recognised as a cycle
 * rather than as very deep nesting.
 */
type Ctx = {
  root: Record<string, unknown>
  diagnostics: Diagnostic[]
  following: string[]
  depth: number
}

/** Raised inside the plain recursion below and caught once, at the entry point. */
class RefusedError extends Error {
  constructor(readonly diagnostic: Diagnostic) {
    super(diagnostic.message)
  }
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** JSON Pointer escaping: `~` becomes `~0` and `/` becomes `~1`, in that order. */
const token = (segment: string) => segment.replaceAll('~', '~0').replaceAll('/', '~1')

/**
 * JSON Schema document → generation plan.
 *
 * The plan is what the generator executes; the document is what laqi stores.
 * Compiling is therefore the only place the two vocabularies meet, and it is
 * deliberately strict: a keyword laqi does not understand is an assertion
 * about the data it cannot honour, so it is refused by name rather than
 * quietly ignored.
 */
export function compileSchema(document: unknown): CompileResult {
  const diagnostics: Diagnostic[] = []
  const root = isObject(document) ? document : {}
  try {
    const plan = compile(document, '', { root, diagnostics, following: [], depth: 0 })
    return { ok: true, plan, diagnostics }
  } catch (error) {
    if (error instanceof RefusedError) return { ok: false, diagnostics: [error.diagnostic] }
    throw error
  }
}

function refuse(code: Parameters<typeof diagnostic>[0], message: string, pointer: string): never {
  throw new RefusedError(diagnostic(code, message, pointer))
}

function compile(node: unknown, pointer: string, ctx: Ctx): Plan {
  // `true` allows every value and `false` allows none. Both are schemas, and
  // they are the only non-object ones.
  if (node === true) return { kind: 'unknown' }
  if (node === false) {
    refuse('unsatisfiable', 'this schema is false, and no value satisfies it', pointer)
  }
  if (!isObject(node)) {
    refuse(
      'invalid.document',
      `a schema is an object or a boolean, not ${node === null ? 'null' : typeof node}`,
      pointer,
    )
  }

  if (ctx.depth > MAX_SHAPE_DEPTH) {
    refuse('loss.depth', `this document nests deeper than ${MAX_SHAPE_DEPTH} levels`, pointer)
  }

  const keywords = Object.keys(node).filter((keyword) => !ANNOTATIONS.has(keyword))

  // A reference stands in for the schema it names, so it is resolved before
  // any other keyword is read.
  if (keywords.includes('$ref')) return reference(node, pointer, keywords, ctx)

  // `enum` decides on its own: it lists the permitted values outright, so
  // whatever `type` says about them is already implied.
  if (keywords.includes('enum')) return literals(node, pointer, keywords)

  const type = node.type
  if (type === undefined) {
    reject(keywords, [], node, pointer)
    return { kind: 'unknown' }
  }
  if (typeof type !== 'string') {
    refuse('unsupported.keyword', `"type" must name one type here, not ${typeof type}`, pointer)
  }

  switch (type) {
    case 'object':
      return object(node, pointer, keywords, ctx)
    case 'array':
      return array(node, pointer, keywords, ctx)
    case 'string':
      return string(node, pointer, keywords)
    case 'number':
    case 'integer':
    case 'boolean':
    case 'null':
      reject(keywords, ['type'], node, pointer)
      return { kind: 'primitive', type: PRIMITIVES[type]! }
    default:
      refuse(
        'unsupported.keyword',
        `laqi generates no values of type ${JSON.stringify(type)}`,
        pointer,
      )
  }
}

/**
 * Every keyword the caller did not consume is an assertion about the data
 * that the plan does not carry, so it is refused by name. Silence here would
 * mean generating values that the document says are invalid.
 */
function reject(
  keywords: string[],
  consumed: string[],
  node: Record<string, unknown>,
  pointer: string,
): void {
  const left = keywords.filter((keyword) => !consumed.includes(keyword))
  if (left.length === 0) return
  const [first] = left
  refuse(
    'unsupported.keyword',
    `laqi does not honour ${JSON.stringify(first)}${
      left.length > 1 ? ` (and ${left.length - 1} more here)` : ''
    }, and will not generate values that ignore it`,
    pointer,
  )
}

function literals(node: Record<string, unknown>, pointer: string, keywords: string[]): Plan {
  const values = node.enum
  if (!Array.isArray(values)) {
    refuse('invalid.document', '"enum" must be an array of values', pointer)
  }
  if (values.length === 0) {
    refuse('unsatisfiable', '"enum" is empty, so no value satisfies it', pointer)
  }
  for (const value of values) {
    const kind = value === null ? 'null' : typeof value
    if (!['string', 'number', 'boolean', 'null'].includes(kind)) {
      refuse('unsupported.keyword', `laqi picks only scalar enum members, not ${kind}`, pointer)
    }
  }
  // `type` beside `enum` narrows a list laqi already generates from.
  reject(keywords, ['enum', 'type'], node, pointer)
  return { kind: 'literals', values: values as PlanLiteral[] }
}

function string(node: Record<string, unknown>, pointer: string, keywords: string[]): Plan {
  // The one format the minimum vocabulary carries, because it is the only
  // one a Shape can express: `date` is a distinct primitive to the generator.
  if (node.format === 'date-time') {
    reject(keywords, ['type', 'format'], node, pointer)
    return { kind: 'primitive', type: 'date' }
  }
  reject(keywords, ['type'], node, pointer)
  return { kind: 'primitive', type: 'string' }
}

function object(
  node: Record<string, unknown>,
  pointer: string,
  keywords: string[],
  ctx: Ctx,
): Plan {
  const properties = node.properties
  const additional = node.additionalProperties

  // Named properties make it an object. A closed one says
  // `additionalProperties: false`, which changes nothing about generation —
  // laqi never invents a property it was not given.
  if (properties !== undefined) {
    if (!isObject(properties)) {
      refuse('invalid.document', '"properties" must be an object', pointer)
    }
    reject(keywords, ['type', 'properties', 'required', 'additionalProperties'], node, pointer)

    const required = requiredNames(node, pointer)
    const fields: PlanField[] = Object.entries(properties).map(([name, schema]) => ({
      name,
      plan: compile(schema, `${pointer}/properties/${token(name)}`, deeper(ctx)),
      optional: !required.includes(name),
    }))

    // A required name with no schema beside it still has to appear in the
    // body, so it is generated as unconstrained and reported.
    for (const name of required) {
      if (name in properties) continue
      ctx.diagnostics.push(
        diagnostic(
          'loss.unresolved-type',
          `${JSON.stringify(name)} is required but has no schema, so it is generated as unconstrained`,
          `${pointer}/required`,
        ),
      )
      fields.push({ name, plan: { kind: 'unknown' }, optional: false })
    }
    return { kind: 'object', fields }
  }

  // No named properties, but a schema for every key: a map.
  if (additional !== undefined && additional !== false) {
    reject(keywords, ['type', 'additionalProperties'], node, pointer)
    return {
      kind: 'record',
      values: compile(additional, `${pointer}/additionalProperties`, deeper(ctx)),
    }
  }

  // An object that constrains nothing. There is no key to invent.
  reject(keywords, ['type', 'additionalProperties'], node, pointer)
  return { kind: 'object', fields: [] }
}

function requiredNames(node: Record<string, unknown>, pointer: string): string[] {
  const required = node.required
  if (required === undefined) return []
  if (!Array.isArray(required) || required.some((name) => typeof name !== 'string')) {
    refuse('invalid.document', '"required" must be an array of property names', pointer)
  }
  return required as string[]
}

function array(node: Record<string, unknown>, pointer: string, keywords: string[], ctx: Ctx): Plan {
  const prefixItems = node.prefixItems

  // A fixed-arity array. 2020-12 has no tuple keyword: `prefixItems` gives
  // each position a schema and `items: false` closes the array after them.
  if (prefixItems !== undefined) {
    if (!Array.isArray(prefixItems)) {
      refuse('invalid.document', '"prefixItems" must be an array of schemas', pointer)
    }
    if (node.items !== false) {
      refuse(
        'unsupported.keyword',
        '"prefixItems" without "items": false leaves the arity open, which laqi cannot generate',
        pointer,
      )
    }
    reject(keywords, ['type', 'prefixItems', 'items', 'minItems', 'maxItems'], node, pointer)
    checkTupleArity(node, prefixItems.length, pointer)
    return {
      kind: 'tuple',
      items: prefixItems.map((item, index) =>
        compile(item, `${pointer}/prefixItems/${index}`, deeper(ctx)),
      ),
    }
  }

  const items = node.items
  if (items === undefined) {
    refuse(
      'unsupported.keyword',
      'an array with no "items" says nothing about its elements, so laqi has nothing to generate',
      pointer,
    )
  }
  reject(keywords, ['type', 'items'], node, pointer)
  return { kind: 'array', items: compile(items, `${pointer}/items`, deeper(ctx)) }
}

/**
 * `minItems`/`maxItems` beside a tuple restate its arity for consumers that
 * do not read `prefixItems`. Anything else contradicts the tuple.
 */
function checkTupleArity(node: Record<string, unknown>, arity: number, pointer: string): void {
  for (const keyword of ['minItems', 'maxItems'] as const) {
    const value = node[keyword]
    if (value === undefined) continue
    if (value !== arity) {
      refuse(
        'unsatisfiable',
        `"${keyword}" is ${JSON.stringify(value)} but the tuple has exactly ${arity} positions`,
        pointer,
      )
    }
  }
}

/** One level further into the document, for the nesting budget. */
const deeper = (ctx: Ctx): Ctx => ({ ...ctx, depth: ctx.depth + 1 })

/**
 * `$ref` → the schema it names.
 *
 * Only pointers into this same document are followed. A reference to
 * another file or a URL is refused rather than fetched: import, generation
 * and export make no network requests, and a mock server that reached out
 * to resolve a schema would be a surprise nobody asked for.
 */
function reference(
  node: Record<string, unknown>,
  pointer: string,
  keywords: string[],
  ctx: Ctx,
): Plan {
  const ref = node.$ref
  if (typeof ref !== 'string') {
    refuse('invalid.document', '"$ref" must be a string', pointer)
  }
  if (!ref.startsWith('#')) {
    refuse(
      'unsupported.keyword',
      `laqi resolves references inside the document only, and never fetches one; ${JSON.stringify(ref)} points elsewhere`,
      pointer,
    )
  }

  // A reference already being followed closes a cycle. Cutting it here, at
  // the edge that closes it, keeps the plan finite and says exactly where
  // the document stopped being represented.
  if (ctx.following.includes(ref)) {
    ctx.diagnostics.push(
      diagnostic(
        'loss.circular',
        `${JSON.stringify(ref)} refers back to a schema already being resolved, so the plan stops here`,
        pointer,
      ),
    )
    return { kind: 'unknown' }
  }

  // 2020-12 gives `$ref` no siblings that change what it names; anything
  // else beside it would be silently dropped.
  reject(keywords, ['$ref'], node, pointer)

  const target = resolvePointer(ctx.root, ref, pointer)
  return compile(target, pointer, {
    ...ctx,
    following: [...ctx.following, ref],
    depth: ctx.depth + 1,
  })
}

/** `#/a/b` → the value at that path, with `~1` and `~0` unescaped per RFC 6901. */
function resolvePointer(root: Record<string, unknown>, ref: string, pointer: string): unknown {
  if (ref === '#' || ref === '#/') return root

  let current: unknown = root
  for (const segment of ref.slice(2).split('/')) {
    const name = segment.replaceAll('~1', '/').replaceAll('~0', '~')
    if (Array.isArray(current)) {
      current = current[Number(name)]
    } else if (isObject(current)) {
      current = current[name]
    } else {
      current = undefined
    }
    if (current === undefined) {
      refuse(
        'invalid.document',
        `${JSON.stringify(ref)} resolves to nothing in this document`,
        pointer,
      )
    }
  }
  return current
}
