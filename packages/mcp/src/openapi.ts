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
export async function importOpenapi(
  document: unknown,
  options: { allowLoss?: boolean } = {},
): Promise<ImportResult> {
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

      const built = await buildResponses({
        raw: operation.responses,
        document,
        rawPath,
        method,
        where,
        skipped,
        allowLoss: options.allowLoss === true,
      })
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

/**
 * One laqi response per declared status code, with what laqi knows about
 * where its body came from.
 *
 * Two paths, and the difference is recorded rather than smoothed over:
 *
 * - The spec supplies an example. That example IS the body, byte for value —
 *   it is what the API's authors say the response looks like, and improving
 *   on it would be laqi substituting its own guess for their statement. The
 *   schema is still associated, so the response can be regenerated later on
 *   purpose, but no `generation` is written: laqi did not produce these bytes
 *   and must not claim it did.
 * - Otherwise the body is generated from the schema through the same compiler
 *   every other source uses, and `generation` records the seed and options
 *   that reproduce it.
 *
 * A schema laqi cannot import is reported in `skipped`, and the response is
 * still created with its status and description. An endpoint that serves the
 * right status with no body beats an endpoint that was dropped.
 */
async function buildResponses(params: {
  raw: unknown
  document: Record<string, unknown>
  rawPath: string
  method: string
  where: string
  skipped: { where: string; reason: string }[]
  allowLoss: boolean
}): Promise<{ responses: Record<string, MockResponse>; names: string[]; defaultName: string }> {
  const { raw, document, rawPath, method, where, skipped, allowLoss } = params
  const responses: Record<string, MockResponse> = {}
  const names: string[] = []
  const codes: number[] = []

  if (isObject(raw)) {
    const { importSchema, previewBody, responsePointer } = await import('@laqi/generate')

    for (const [code, value] of Object.entries(raw)) {
      const status = statusOf(code)
      if (status === null) continue

      const name = uniqueName(NAMES[String(status)] ?? `status-${status}`, names)
      names.push(name)
      codes.push(status)

      const response: MockResponse = { status }

      const description =
        isObject(value) && typeof value.description === 'string' ? value.description.trim() : ''
      if (description) response.description = description

      const media = mediaType(value)
      const example = declaredExample(media)

      if (media?.schema !== undefined) {
        try {
          const { snapshot } = await importSchema(
            {
              kind: 'openapi',
              document,
              pointer: responsePointer(rawPath, method, code),
              name: `${NAMES[String(status)] ?? name}`,
            },
            { allowLoss },
          )
          response.schema = snapshot

          if (example === undefined) {
            const preview = await previewBody(snapshot)
            response.body = preview.body
            response.generation = preview.evidence
          }
        } catch (cause) {
          skipped.push({
            where: `${where} (${name})`,
            reason: cause instanceof Error ? cause.message : String(cause),
          })
        }
      }

      // Set after the schema branch so an example always wins, whatever the
      // schema did: the spec's own example is the authors' statement.
      if (example !== undefined) response.body = example

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

/** The JSON media type of one response, when it declares one. */
function mediaType(response: unknown): Record<string, unknown> | undefined {
  if (!isObject(response) || !isObject(response.content)) return undefined
  const json = response.content['application/json']
  return isObject(json) ? json : undefined
}

/**
 * The example the spec supplies, if any. `example` wins over `examples`,
 * and the first entry of `examples` wins among those — OpenAPI gives them no
 * order beyond the one they are written in.
 */
function declaredExample(media: Record<string, unknown> | undefined): unknown {
  if (media === undefined) return undefined
  if (media['example'] !== undefined) return media['example']

  const examples = media['examples']
  if (isObject(examples)) {
    for (const example of Object.values(examples)) {
      if (isObject(example) && example['value'] !== undefined) return example['value']
    }
  }
  return undefined
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

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
