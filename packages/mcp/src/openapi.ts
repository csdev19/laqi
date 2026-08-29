import type { EndpointDefinition, MockResponse } from '@laqi/schema'

export type ImportedEndpoint = {
  method: string
  path: string
  definition: EndpointDefinition
}

export type ImportResult = {
  endpoints: ImportedEndpoint[]
  /** What got skipped and why. Nothing is ever dropped silently. */
  skipped: { where: string; reason: string }[]
}

const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options']

/** Readable names by status. An agent asks for "boom", not "status-500". */
const NAMES: Record<string, string> = {
  '200': 'ok',
  '201': 'created',
  '202': 'accepted',
  '204': 'no-content',
  '400': 'bad-request',
  '401': 'unauthorized',
  '403': 'forbidden',
  '404': 'not-found',
  '409': 'conflict',
  '422': 'unprocessable',
  '429': 'rate-limited',
  '500': 'error',
  '502': 'bad-gateway',
  '503': 'unavailable',
}

/**
 * Converts an already-parsed OpenAPI 3.x document into laqi definitions.
 *
 * JSON only: there is no YAML parser here, and pulling one in for this
 * would be a big dependency for a case the agent can solve on its own by
 * converting the spec before calling.
 *
 * Never throws: whatever it can't convert comes back in `skipped` with the
 * reason, and the rest still gets imported. A spec with a hundred routes
 * and two odd ones is worth more imported at 98% than rejected whole.
 */
export function importOpenapi(document: unknown): ImportResult {
  const skipped: { where: string; reason: string }[] = []
  const endpoints: ImportedEndpoint[] = []

  if (!isObject(document)) {
    return { endpoints: [], skipped: [{ where: '(document)', reason: 'not a JSON object' }] }
  }

  const paths = document.paths
  if (!isObject(paths)) {
    return {
      endpoints: [],
      skipped: [
        { where: '(document)', reason: 'no "paths" object — is this an OpenAPI 3 document?' },
      ],
    }
  }

  const components = isObject(document.components) ? document.components : {}
  const schemas = isObject(components.schemas) ? components.schemas : {}

  for (const [rawPath, item] of Object.entries(paths)) {
    if (!isObject(item)) {
      skipped.push({ where: rawPath, reason: 'path item is not an object' })
      continue
    }

    for (const method of METHODS) {
      const operation = item[method]
      if (operation === undefined) continue
      if (!isObject(operation)) {
        skipped.push({
          where: `${method.toUpperCase()} ${rawPath}`,
          reason: 'operation is not an object',
        })
        continue
      }

      const path = toLaqiPath(rawPath)
      const where = `${method.toUpperCase()} ${path}`

      const built = buildResponses(operation.responses, schemas)
      if (built.names.length === 0) {
        skipped.push({ where, reason: 'no usable responses declared' })
        continue
      }

      endpoints.push({
        method: method.toUpperCase(),
        path,
        definition: {
          description: describe(operation),
          default: built.defaultName,
          responses: built.responses,
        },
      })
    }
  }

  return { endpoints, skipped }
}

/** `/users/{id}` → `/users/:id`, which is what the router understands. */
export function toLaqiPath(path: string): string {
  return path.replace(/\{([^}]+)\}/g, ':$1')
}

function describe(operation: Record<string, unknown>): string | undefined {
  const summary = typeof operation.summary === 'string' ? operation.summary.trim() : ''
  if (summary) return summary
  const description = typeof operation.description === 'string' ? operation.description.trim() : ''
  // First line only: an OpenAPI description is often long markdown, and
  // this goes into a table row.
  return description ? description.split('\n')[0]!.trim() : undefined
}

function buildResponses(
  raw: unknown,
  schemas: Record<string, unknown>,
): { responses: Record<string, MockResponse>; names: string[]; defaultName: string } {
  const responses: Record<string, MockResponse> = {}
  const names: string[] = []
  const codes: number[] = []

  if (isObject(raw)) {
    for (const [code, value] of Object.entries(raw)) {
      const status = statusOf(code)
      if (status === null) continue

      const name = uniqueName(NAMES[String(status)] ?? `status-${status}`, names)
      names.push(name)
      codes.push(status)

      const response: MockResponse = { status }
      const body = exampleBody(value, schemas)
      if (body !== undefined) response.body = body

      const description =
        isObject(value) && typeof value.description === 'string' ? value.description.trim() : ''
      if (description) response.description = description

      responses[name] = response
    }
  }

  // The default is the lowest 2xx — the happy path. If there isn't one,
  // the first one declared, so the endpoint always has something to serve.
  let defaultIndex = 0
  let best = Number.POSITIVE_INFINITY
  for (const [index, status] of codes.entries()) {
    if (status >= 200 && status < 300 && status < best) {
      best = status
      defaultIndex = index
    }
  }

  return { responses, names, defaultName: names[defaultIndex] ?? '' }
}

function statusOf(code: string): number | null {
  // `default` and OpenAPI's `2XX` ranges aren't a concrete status.
  const parsed = Number(code)
  if (!Number.isInteger(parsed) || parsed < 100 || parsed > 599) return null
  return parsed
}

function uniqueName(base: string, taken: string[]): string {
  if (!taken.includes(base)) return base
  let index = 2
  while (taken.includes(`${base}-${index}`)) index++
  return `${base}-${index}`
}

function exampleBody(response: unknown, schemas: Record<string, unknown>): unknown {
  if (!isObject(response) || !isObject(response.content)) return undefined

  const json = response.content['application/json']
  if (!isObject(json)) return undefined

  // A hand-written example always wins over one generated from the schema.
  if (json.example !== undefined) return json.example

  if (isObject(json.examples)) {
    for (const example of Object.values(json.examples)) {
      if (isObject(example) && example.value !== undefined) return example.value
    }
  }

  if (json.schema !== undefined) return fromSchema(json.schema, schemas, new Set(), 0)

  return undefined
}

const MAX_DEPTH = 8

/**
 * A plausible example built from a JSON Schema. It doesn't aim to be
 * complete: it's enough for the frontend to receive the right shape and be
 * able to edit it. `seen` cuts off circular `$ref`s, which are common in
 * real specs.
 */
function fromSchema(
  schema: unknown,
  schemas: Record<string, unknown>,
  seen: Set<string>,
  depth: number,
): unknown {
  if (depth > MAX_DEPTH || !isObject(schema)) return null

  if (typeof schema.$ref === 'string') {
    const name = schema.$ref.replace('#/components/schemas/', '')
    if (seen.has(name)) return null
    const target = schemas[name]
    if (target === undefined) return null
    return fromSchema(target, schemas, new Set([...seen, name]), depth + 1)
  }

  if (schema.example !== undefined) return schema.example
  if (schema.default !== undefined) return schema.default
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0]

  for (const key of ['allOf', 'oneOf', 'anyOf'] as const) {
    const branch = schema[key]
    if (Array.isArray(branch) && branch.length > 0) {
      if (key === 'allOf') {
        // allOf is an intersection: merge all the branches into one object.
        const merged: Record<string, unknown> = {}
        for (const part of branch) {
          const value = fromSchema(part, schemas, seen, depth + 1)
          if (isObject(value)) Object.assign(merged, value)
        }
        return merged
      }
      return fromSchema(branch[0], schemas, seen, depth + 1)
    }
  }

  switch (schema.type) {
    case 'object':
      return objectFrom(schema, schemas, seen, depth)
    case 'array':
      return [fromSchema(schema.items, schemas, seen, depth + 1)]
    case 'string':
      return stringFor(schema)
    case 'integer':
    case 'number':
      return 0
    case 'boolean':
      return true
    case 'null':
      return null
    default:
      // No `type` but with `properties` is an object in practice.
      return isObject(schema.properties) ? objectFrom(schema, schemas, seen, depth) : null
  }
}

function objectFrom(
  schema: Record<string, unknown>,
  schemas: Record<string, unknown>,
  seen: Set<string>,
  depth: number,
): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  if (!isObject(schema.properties)) return result

  for (const [key, value] of Object.entries(schema.properties)) {
    result[key] = fromSchema(value, schemas, seen, depth + 1)
  }
  return result
}

function stringFor(schema: Record<string, unknown>): string {
  switch (schema.format) {
    case 'date-time':
      return '2026-01-01T00:00:00Z'
    case 'date':
      return '2026-01-01'
    case 'email':
      return 'ada@example.com'
    case 'uuid':
      return '00000000-0000-4000-8000-000000000000'
    case 'uri':
    case 'url':
      return 'https://example.com'
    default:
      return 'string'
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
