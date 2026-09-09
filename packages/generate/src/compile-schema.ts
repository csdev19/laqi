import { diagnostic, type Diagnostic } from '@laqi/schema'
import type {
  ItemsRule,
  NumberRule,
  Plan,
  PlanField,
  PlanLiteral,
  TextFormat,
  TextRule,
} from './plan'
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

  // `enum` and `const` decide on their own: they list the permitted values
  // outright, so whatever `type` says about them is already implied.
  if (keywords.includes('enum')) return literals(node, pointer, keywords)
  if (keywords.includes('const')) return constant(node, pointer, keywords)

  // A choice between alternatives, each of which laqi must be able to
  // generate on its own.
  for (const keyword of ['anyOf', 'oneOf'] as const) {
    if (keywords.includes(keyword)) return alternatives(node, keyword, pointer, keywords, ctx)
  }
  if (keywords.includes('allOf')) return intersection(node, pointer, keywords, ctx)

  const type = node.type
  if (type === undefined) {
    reject(keywords, [], node, pointer)
    return { kind: 'unknown' }
  }

  // A list of type names is a choice between them, each still subject to
  // the keywords beside it.
  if (Array.isArray(type)) return typeUnion(node, type, pointer, keywords, ctx)

  if (typeof type !== 'string') {
    refuse(
      'unsupported.keyword',
      `"type" must be a name or a list of names, not ${typeof type}`,
      pointer,
    )
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
      return number(node, type, pointer, keywords)
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

/** The string formats laqi can produce a value for. Anything else is refused. */
const TEXT_FORMATS = new Set<TextFormat>(['date', 'email', 'uri', 'uuid'])

function string(node: Record<string, unknown>, pointer: string, keywords: string[]): Plan {
  reject(keywords, ['type', 'format', 'minLength', 'maxLength'], node, pointer)

  const format = node.format
  // `date-time` is not a string format to the generator: it is the `date`
  // primitive, which is what a Shape calls the same thing.
  if (format === 'date-time') {
    if (node.minLength === undefined && node.maxLength === undefined) {
      return { kind: 'primitive', type: 'date' }
    }
  }

  const rule: TextRule = {}
  const minLength = numeric(node, 'minLength', pointer)
  const maxLength = numeric(node, 'maxLength', pointer)
  if (minLength !== undefined) rule.minLength = minLength
  if (maxLength !== undefined) rule.maxLength = maxLength
  if (minLength !== undefined && maxLength !== undefined && minLength > maxLength) {
    refuse(
      'unsatisfiable',
      `"minLength" is ${minLength} and "maxLength" is ${maxLength}, so no string satisfies both`,
      pointer,
    )
  }

  if (format !== undefined) {
    const named = format === 'date-time' ? 'date' : format
    if (typeof named !== 'string' || !TEXT_FORMATS.has(named as TextFormat)) {
      refuse(
        'unsupported.keyword',
        `laqi generates the formats ${[...TEXT_FORMATS].join(', ')} and date-time; it has no generator for ${JSON.stringify(format)}`,
        pointer,
      )
    }
    rule.format = named as TextFormat
  }

  return Object.keys(rule).length === 0
    ? { kind: 'primitive', type: 'string' }
    : { kind: 'primitive', type: 'string', text: rule }
}

/** One numeric keyword, checked to be a real number rather than trusted. */
function numeric(
  node: Record<string, unknown>,
  keyword: string,
  pointer: string,
): number | undefined {
  const value = node[keyword]
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    refuse('invalid.document', `"${keyword}" must be a number`, pointer)
  }
  return value
}

function constant(node: Record<string, unknown>, pointer: string, keywords: string[]): Plan {
  const value = node.const
  const kind = value === null ? 'null' : typeof value
  if (!['string', 'number', 'boolean', 'null'].includes(kind)) {
    refuse('unsupported.keyword', `laqi generates only scalar constants, not ${kind}`, pointer)
  }
  reject(keywords, ['const', 'type'], node, pointer)
  return { kind: 'literals', values: [value as PlanLiteral] }
}

function number(
  node: Record<string, unknown>,
  type: 'number' | 'integer',
  pointer: string,
  keywords: string[],
): Plan {
  reject(
    keywords,
    ['type', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf'],
    node,
    pointer,
  )

  const step = type === 'integer' ? 1 : Number.EPSILON
  const exclusiveMinimum = numeric(node, 'exclusiveMinimum', pointer)
  const exclusiveMaximum = numeric(node, 'exclusiveMaximum', pointer)
  const minimum = numeric(node, 'minimum', pointer) ?? bump(exclusiveMinimum, step)
  const maximum = numeric(node, 'maximum', pointer) ?? bump(exclusiveMaximum, -step)
  const multipleOf = numeric(node, 'multipleOf', pointer)

  if (minimum !== undefined && maximum !== undefined && minimum > maximum) {
    refuse(
      'unsatisfiable',
      `the bounds ${minimum} and ${maximum} cross, so no number satisfies them`,
      pointer,
    )
  }
  if (multipleOf !== undefined && multipleOf <= 0) {
    refuse('invalid.document', '"multipleOf" must be greater than zero', pointer)
  }

  const rule: NumberRule = {}
  if (minimum !== undefined) rule.minimum = minimum
  if (maximum !== undefined) rule.maximum = maximum
  if (multipleOf !== undefined) rule.multipleOf = multipleOf

  return Object.keys(rule).length === 0
    ? { kind: 'primitive', type }
    : { kind: 'primitive', type, number: rule }
}

/** An exclusive bound becomes the nearest inclusive one the type can represent. */
const bump = (bound: number | undefined, step: number): number | undefined =>
  bound === undefined ? undefined : bound + step

function typeUnion(
  node: Record<string, unknown>,
  types: unknown[],
  pointer: string,
  keywords: string[],
  ctx: Ctx,
): Plan {
  if (types.length === 0) {
    refuse('unsatisfiable', '"type" lists no types, so no value satisfies it', pointer)
  }
  const options = types.map((name) => {
    if (typeof name !== 'string' || !(name in PRIMITIVES)) {
      refuse(
        'unsupported.keyword',
        `a list of types holds primitive names only; ${JSON.stringify(name)} needs a schema of its own`,
        pointer,
      )
    }
    return compile({ ...node, type: name }, pointer, ctx)
  })
  return options.length === 1 ? options[0]! : { kind: 'choice', options }
}

/**
 * `anyOf`/`oneOf` → a choice, but only between alternatives laqi can pick
 * blindly. Choosing between two object shapes would mean deciding which one
 * the API returns, which is the caller's decision and not laqi's.
 */
function alternatives(
  node: Record<string, unknown>,
  keyword: 'anyOf' | 'oneOf',
  pointer: string,
  keywords: string[],
  ctx: Ctx,
): Plan {
  const members = node[keyword]
  if (!Array.isArray(members) || members.length === 0) {
    refuse('invalid.document', `"${keyword}" must be a non-empty array of schemas`, pointer)
  }
  reject(keywords, [keyword], node, pointer)

  const options = members.map((member, index) =>
    compile(member, `${pointer}/${keyword}/${index}`, deeper(ctx)),
  )
  for (const option of options) {
    if (option.kind !== 'primitive' && option.kind !== 'literals' && option.kind !== 'choice') {
      refuse(
        'unsupported.combination',
        `laqi picks between scalars and enums; this "${keyword}" offers a ${option.kind}, and choosing one would be laqi deciding what the API returns`,
        pointer,
      )
    }
  }
  return options.length === 1 ? options[0]! : { kind: 'choice', options }
}

/**
 * `allOf` → one merged object. Only disjoint objects merge: two members
 * claiming the same property state two rules for it, and picking one would
 * be guessing.
 */
function intersection(
  node: Record<string, unknown>,
  pointer: string,
  keywords: string[],
  ctx: Ctx,
): Plan {
  const members = node.allOf
  if (!Array.isArray(members) || members.length === 0) {
    refuse('invalid.document', '"allOf" must be a non-empty array of schemas', pointer)
  }
  reject(keywords, ['allOf', 'type'], node, pointer)

  const fields: PlanField[] = []
  const claimed = new Set<string>()
  for (const [index, member] of members.entries()) {
    const plan = compile(member, `${pointer}/allOf/${index}`, deeper(ctx))
    if (plan.kind !== 'object') {
      refuse(
        'unsupported.combination',
        `laqi merges "allOf" of objects; member ${index} is a ${plan.kind}`,
        pointer,
      )
    }
    for (const field of plan.fields) {
      if (claimed.has(field.name)) {
        refuse(
          'unsupported.combination',
          `two "allOf" members both describe ${JSON.stringify(field.name)}, and laqi will not choose between their rules`,
          pointer,
        )
      }
      claimed.add(field.name)
      fields.push(field)
    }
  }
  return { kind: 'object', fields }
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
  reject(keywords, ['type', 'items', 'minItems', 'maxItems', 'uniqueItems'], node, pointer)

  const min = numeric(node, 'minItems', pointer)
  const max = numeric(node, 'maxItems', pointer)
  if (min !== undefined && max !== undefined && min > max) {
    refuse(
      'unsatisfiable',
      `"minItems" is ${min} and "maxItems" is ${max}, so no array satisfies both`,
      pointer,
    )
  }

  const rule: ItemsRule = {}
  if (min !== undefined) rule.min = min
  if (max !== undefined) rule.max = max
  // Only `true` says anything: `uniqueItems: false` is the default.
  if (node.uniqueItems === true) rule.unique = true

  const plan = compile(items, `${pointer}/items`, deeper(ctx))
  return Object.keys(rule).length === 0
    ? { kind: 'array', items: plan }
    : { kind: 'array', items: plan, length: rule }
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
