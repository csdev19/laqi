import { diagnostic, DIALECT_2020_12, type Diagnostic } from '@laqi/schema'

const DRAFT_07 = new Set([
  'http://json-schema.org/draft-07/schema#',
  'https://json-schema.org/draft-07/schema#',
  'http://json-schema.org/draft-07/schema',
  'https://json-schema.org/draft-07/schema',
])

const DRAFT_2020_12 = new Set([
  DIALECT_2020_12,
  'https://json-schema.org/draft/2020-12/schema#',
  'http://json-schema.org/draft/2020-12/schema',
])

/**
 * Keywords whose value is one schema. Everything not listed in one of these
 * three tables is data, and is copied without being walked — which is what
 * keeps a property honestly named `items` or `not` from being mistaken for a
 * keyword.
 */
const SCHEMA_VALUED = new Set([
  'additionalProperties',
  'additionalItems',
  'contains',
  'else',
  'if',
  'items',
  'not',
  'propertyNames',
  'then',
  'unevaluatedItems',
  'unevaluatedProperties',
])

/** Keywords whose value is an array of schemas. */
const SCHEMA_ARRAYS = new Set(['allOf', 'anyOf', 'oneOf', 'prefixItems'])

/** Keywords whose value is an object whose every value is a schema. */
const SCHEMA_MAPS = new Set([
  '$defs',
  'definitions',
  'dependentSchemas',
  'patternProperties',
  'properties',
])

export type NormalizeOptions = {
  /**
   * The dialect to assume when the document declares none. OpenAPI 3.0
   * schemas carry no `$schema`, and nothing in them distinguishes one from a
   * plain schema, so the importer says which it is rather than the
   * normalizer guessing.
   */
  assume?: 'openapi-3.0'
}

export type NormalizeResult =
  | { ok: true; document: Record<string, unknown>; diagnostics: Diagnostic[] }
  | { ok: false; diagnostics: Diagnostic[] }

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Any accepted dialect → draft 2020-12.
 *
 * laqi stores one dialect, so this runs before anything reads a document:
 * the compiler, the writer and every exporter can then assume 2020-12 and
 * carry no dialect branches of their own. The input is never mutated.
 */
export function normalizeDialect(
  document: unknown,
  options: NormalizeOptions = {},
): NormalizeResult {
  if (!isObject(document)) {
    return {
      ok: false,
      diagnostics: [
        diagnostic(
          'invalid.document',
          `a document is a JSON Schema object, not ${
            document === null ? 'null' : Array.isArray(document) ? 'an array' : typeof document
          }`,
          '',
        ),
      ],
    }
  }

  const declared = document.$schema
  if (declared !== undefined && typeof declared !== 'string') {
    return {
      ok: false,
      diagnostics: [diagnostic('dialect.unknown', '"$schema" must be a string', '/$schema')],
    }
  }

  if (declared !== undefined && !DRAFT_2020_12.has(declared) && !DRAFT_07.has(declared)) {
    return {
      ok: false,
      diagnostics: [
        diagnostic(
          'dialect.unknown',
          `laqi normalizes draft 2020-12 and draft-07; ${JSON.stringify(declared)} is neither`,
          '/$schema',
        ),
      ],
    }
  }

  if (declared !== undefined && DRAFT_2020_12.has(declared)) {
    return { ok: true, document: { ...document, $schema: DIALECT_2020_12 }, diagnostics: [] }
  }

  const rewrite = DRAFT_07.has(declared ?? '')
    ? draft07
    : options.assume === 'openapi-3.0'
      ? openapi30
      : undefined

  const walked = walk(document, rewrite)
  const normalized = { ...walked, $schema: DIALECT_2020_12 }

  return {
    ok: true,
    document: normalized,
    diagnostics: [diagnostic('dialect.normalized', describe(declared, options), '')],
  }
}

function describe(declared: string | undefined, options: NormalizeOptions): string {
  if (declared !== undefined) return 'draft-07 forms were rewritten to draft 2020-12'
  if (options.assume === 'openapi-3.0') {
    return 'OpenAPI 3.0 schema forms were rewritten to draft 2020-12'
  }
  return 'this document declares no "$schema", so it was read as draft 2020-12'
}

/** One node's rewrite, applied after its children have been rewritten. */
type Rewrite = (node: Record<string, unknown>) => Record<string, unknown>

function walk(
  node: Record<string, unknown>,
  rewrite: Rewrite | undefined,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [keyword, value] of Object.entries(node)) {
    if (SCHEMA_VALUED.has(keyword)) {
      out[keyword] = walkSchema(value, rewrite)
    } else if (SCHEMA_ARRAYS.has(keyword) && Array.isArray(value)) {
      out[keyword] = value.map((item) => walkSchema(item, rewrite))
    } else if (SCHEMA_MAPS.has(keyword) && isObject(value)) {
      out[keyword] = Object.fromEntries(
        Object.entries(value).map(([name, schema]) => [name, walkSchema(schema, rewrite)]),
      )
    } else {
      out[keyword] = value
    }
  }
  return rewrite ? rewrite(out) : out
}

/** A schema position may hold a boolean, an object, or — in draft-07 `items` — an array. */
function walkSchema(value: unknown, rewrite: Rewrite | undefined): unknown {
  if (isObject(value)) return walk(value, rewrite)
  if (Array.isArray(value)) return value.map((item) => walkSchema(item, rewrite))
  return value
}

function draft07(node: Record<string, unknown>): Record<string, unknown> {
  const out = { ...node }

  if (out.definitions !== undefined && out.$defs === undefined) {
    out.$defs = out.definitions
    delete out.definitions
  }

  // draft-07 spells a tuple as an array of schemas in `items`, with
  // `additionalItems` governing what may follow. 2020-12 splits the two.
  if (Array.isArray(out.items)) {
    out.prefixItems = out.items
    delete out.items
    if (out.additionalItems !== undefined) {
      out.items = out.additionalItems
      delete out.additionalItems
    }
  }

  if (typeof out.$ref === 'string' && out.$ref.startsWith('#/definitions/')) {
    out.$ref = out.$ref.replace('#/definitions/', '#/$defs/')
  }

  return out
}

function openapi30(node: Record<string, unknown>): Record<string, unknown> {
  const out = { ...node }

  if (out.nullable !== undefined) {
    const nullable = out.nullable === true
    delete out.nullable
    if (nullable && typeof out.type === 'string') out.type = [out.type, 'null']
    else if (nullable && Array.isArray(out.type) && !out.type.includes('null')) {
      out.type = [...out.type, 'null']
    }
  }

  if (out.example !== undefined) {
    if (out.examples === undefined) out.examples = [out.example]
    delete out.example
  }

  return out
}
