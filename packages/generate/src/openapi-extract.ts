import { diagnostic, type Diagnostic } from '@laqi/schema'

/** Where a response's schema sits in an OpenAPI document. */
export function responsePointer(path: string, method: string, code: string): string {
  return [
    '/paths',
    escapeSegment(path),
    method.toLowerCase(),
    'responses',
    code,
    'content',
    escapeSegment('application/json'),
    'schema',
  ].join('/')
}

/** Where a response's example sits, when it supplies one directly. */
export function examplePointer(path: string, method: string, code: string): string {
  return [
    '/paths',
    escapeSegment(path),
    method.toLowerCase(),
    'responses',
    code,
    'content',
    escapeSegment('application/json'),
  ].join('/')
}

/** RFC 6901: `~` is `~0` and `/` is `~1`, in that order. */
function escapeSegment(segment: string): string {
  return segment.replaceAll('~', '~0').replaceAll('/', '~1')
}

export type Extraction =
  | { ok: true; document: Record<string, unknown>; diagnostics: Diagnostic[] }
  | { ok: false; diagnostics: Diagnostic[] }

/**
 * One response schema, lifted out of its OpenAPI document as a document of
 * its own.
 *
 * A response schema is not self-contained: it refers to `components.schemas`
 * by `$ref`, and those refer to each other. Storing the fragment alone would
 * store something that cannot be compiled, and storing the whole API document
 * on every response would store the entire specification once per response.
 * So the components come along as `$defs`, and the references are rewritten
 * to point at them.
 *
 * Every component is carried, not only the reachable ones: deciding
 * reachability means resolving every `$ref` first, which is the compiler's
 * job and its cycle handling, and getting it subtly wrong would produce a
 * document that compiles here and fails after a reload.
 */
export function extractResponseSchema(source: unknown, pointer: string): Extraction {
  if (!isObject(source)) {
    return {
      ok: false,
      diagnostics: [diagnostic('invalid.document', 'an OpenAPI document is a JSON object')],
    }
  }

  const node = resolve(source, pointer)
  if (node === undefined) {
    return {
      ok: false,
      diagnostics: [
        diagnostic(
          'invalid.document',
          `nothing at ${JSON.stringify(pointer)} in this document`,
          pointer,
        ),
      ],
    }
  }
  if (!isObject(node)) {
    return {
      ok: false,
      diagnostics: [
        diagnostic('invalid.document', `${JSON.stringify(pointer)} is not a schema`, pointer),
      ],
    }
  }

  const components = componentSchemas(source)
  const rewritten = rewriteRefs(node) as Record<string, unknown>
  const defs = rewriteRefs(components) as Record<string, unknown>

  // Deliberately NO `$schema`: what comes out of here is still an OpenAPI
  // 3.0 shaped document, and declaring 2020-12 on it would tell the
  // normalizer there is nothing to rewrite — `nullable` would survive to the
  // compiler and be refused as a keyword laqi does not honour.
  const document: Record<string, unknown> = { ...rewritten }
  const existing = isObject(document['$defs']) ? document['$defs'] : {}
  if (Object.keys(defs).length > 0 || Object.keys(existing).length > 0) {
    document['$defs'] = { ...defs, ...existing }
  }

  return { ok: true, document, diagnostics: [] }
}

/** `components.schemas`, or an empty bag when the document declares none. */
function componentSchemas(source: Record<string, unknown>): Record<string, unknown> {
  const components = source['components']
  if (!isObject(components)) return {}
  const schemas = components['schemas']
  return isObject(schemas) ? schemas : {}
}

const COMPONENTS_PREFIX = '#/components/schemas/'

/**
 * Repoints every `#/components/schemas/X` at `#/$defs/X`.
 *
 * Only `$ref` STRING values are touched. A property legitimately named
 * `$ref` holding an object is data, not a reference, and rewriting it would
 * corrupt a schema that merely describes JSON containing that key.
 */
function rewriteRefs(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => rewriteRefs(item))
  if (!isObject(value)) return value

  const out: Record<string, unknown> = {}
  for (const [key, inner] of Object.entries(value)) {
    if (key === '$ref' && typeof inner === 'string' && inner.startsWith(COMPONENTS_PREFIX)) {
      out[key] = `#/$defs/${inner.slice(COMPONENTS_PREFIX.length)}`
      continue
    }
    out[key] = rewriteRefs(inner)
  }
  return out
}

/** Walks a JSON Pointer. Undefined when any segment is missing. */
function resolve(source: Record<string, unknown>, pointer: string): unknown {
  if (pointer === '') return source
  if (!pointer.startsWith('/')) return undefined

  let current: unknown = source
  for (const raw of pointer.slice(1).split('/')) {
    const segment = raw.replaceAll('~1', '/').replaceAll('~0', '~')
    if (Array.isArray(current)) {
      const index = Number(segment)
      if (!Number.isInteger(index) || index < 0 || index >= current.length) return undefined
      current = current[index]
      continue
    }
    if (!isObject(current) || !Object.hasOwn(current, segment)) return undefined
    current = current[segment]
  }
  return current
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
