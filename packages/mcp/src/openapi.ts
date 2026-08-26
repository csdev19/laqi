import type { EndpointDefinition, MockResponse } from '@laqi/schema'

export type ImportedEndpoint = {
  method: string
  path: string
  definition: EndpointDefinition
}

export type ImportResult = {
  endpoints: ImportedEndpoint[]
  /** Lo que se salteó y por qué. Nunca se descarta nada en silencio. */
  skipped: { where: string; reason: string }[]
}

const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options']

/** Nombres legibles por status. Un agente pide "boom", no "status-500". */
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
 * Convierte un documento OpenAPI 3.x ya parseado en definiciones de laqi.
 *
 * Sólo JSON: no hay parser de YAML acá y traer uno por esto sería una
 * dependencia grande para un caso que el agente puede resolver él mismo
 * convirtiendo el spec antes de llamar.
 *
 * Nunca tira: lo que no puede convertir sale en `skipped` con el motivo, y
 * el resto se importa igual. Un spec de cien rutas con dos raras vale más
 * importado al 98% que rechazado entero.
 */
export function importOpenapi(document: unknown): ImportResult {
  const skipped: { where: string; reason: string }[] = []
  const endpoints: ImportedEndpoint[] = []

  if (!isObject(document)) {
    return { endpoints: [], skipped: [{ where: '(document)', reason: 'not a JSON object' }] }
  }

  const paths = document.paths
  if (!isObject(paths)) {
    return { endpoints: [], skipped: [{ where: '(document)', reason: 'no "paths" object — is this an OpenAPI 3 document?' }] }
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
        skipped.push({ where: `${method.toUpperCase()} ${rawPath}`, reason: 'operation is not an object' })
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

/** `/users/{id}` → `/users/:id`, que es lo que entiende el router. */
export function toLaqiPath(path: string): string {
  return path.replace(/\{([^}]+)\}/g, ':$1')
}

function describe(operation: Record<string, unknown>): string | undefined {
  const summary = typeof operation.summary === 'string' ? operation.summary.trim() : ''
  if (summary) return summary
  const description = typeof operation.description === 'string' ? operation.description.trim() : ''
  // Sólo la primera línea: la descripción de OpenAPI suele ser markdown largo
  // y esto va a una fila de una tabla.
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

      const description = isObject(value) && typeof value.description === 'string' ? value.description.trim() : ''
      if (description) response.description = description

      responses[name] = response
    }
  }

  // El default es el 2xx más bajo — el camino feliz. Si no hay ninguno, el
  // primero declarado, para que el endpoint siempre tenga algo que servir.
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
  // `default` y los rangos `2XX` de OpenAPI no son un status concreto.
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

  // Un ejemplo escrito a mano siempre le gana a uno generado del schema.
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
 * Un ejemplo plausible a partir de un JSON Schema. No pretende ser completo:
 * alcanza con que el frontend reciba la forma correcta y pueda editarla.
 * `seen` corta los `$ref` circulares, que son normales en specs reales.
 */
function fromSchema(schema: unknown, schemas: Record<string, unknown>, seen: Set<string>, depth: number): unknown {
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
        // allOf es una intersección: mezclar todas las ramas en un objeto.
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
      // Sin `type` pero con `properties` es un objeto en la práctica.
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
