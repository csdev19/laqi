import type { LaqiEvent, LoadedEndpoint, LoadError } from '@laqi/core'
import {
  EndpointSchema,
  isHttpMethod,
  RESERVED_PREFIX,
  StateSchema,
  type Diagnostic,
  type GenerationEvidence,
  type HttpMethod,
  type LaqiState,
  type SchemaSnapshot,
  type Scenarios,
} from '@laqi/schema'
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { z } from 'zod'

/**
 * Everything the control plane needs from the process that hosts it. Each
 * task in this plan adds the fields its routes need — this type only
 * becomes the complete contract at the end of Task 8.
 */
/** Why a write failed, to pick the right status. */
export type WriteFailure = 'invalid' | 'conflict' | 'not-found'

const STATUS: Record<WriteFailure, 400 | 404 | 409> = {
  invalid: 400,
  conflict: 409,
  'not-found': 404,
}

export type GenerateRequest =
  | {
      model: string
      typeName?: string
      arrayLength?: number
      seed?: number
      /** Acknowledge the approximations the diagnostics name, and import anyway. */
      allowLoss?: boolean
    }
  | { from: { endpointId: string; response: string }; arrayLength?: number; seed?: number }

// Two separate schemas instead of a z.union: a union emits a single
// invalid_union with the generic "Invalid input" message at the top level,
// and the per-branch detail (which field is missing, what type it had)
// stays buried in nested errors that `issues.map(i => i.message)` never
// reaches. Parsing against the right branch once we already know which one
// it is (via the `model`/`from` discriminant key) yields flat issues with
// the correct path.
const ModelVariantSchema = z.object({
  model: z.string().min(1),
  typeName: z.string().optional(),
  arrayLength: z.number().int().optional(),
  seed: z.number().int().optional(),
  allowLoss: z.boolean().optional(),
})

const FromVariantSchema = z.object({
  from: z.object({ endpointId: z.string(), response: z.string() }),
  arrayLength: z.number().int().optional(),
  seed: z.number().int().optional(),
})

/** Only builds a readable message carrying the path of the failed field. */
function issuesToMessage(issues: readonly { path: PropertyKey[]; message: string }[]): string {
  return issues.map((i) => [i.path.join('.'), i.message].filter(Boolean).join(': ')).join('; ')
}

export type ControlPlaneRuntime = {
  getEndpoints: () => LoadedEndpoint[]
  getState: () => LaqiState
  setState: (state: LaqiState) => void
  getScenarios: () => Scenarios
  getStatus: () => {
    watching: string
    endpointCount: number
    address: string
    errors: LoadError[]
    /** `null` when --share is not active. */
    share?: { url: string | null; token: string | null; exposed: string } | null
  }
  createEndpoint: (input: {
    method: HttpMethod
    path: string
    description?: string
    default: string
    responses: Record<string, unknown>
  }) => { ok: true; id: string } | { ok: false; error: string; code?: WriteFailure }
  updateEndpoint: (
    id: string,
    definition: { description?: string; default: string; responses: Record<string, unknown> },
  ) => { ok: true } | { ok: false; error: string; code?: WriteFailure }
  deleteEndpoint: (id: string) => { ok: true } | { ok: false; error: string; code?: WriteFailure }
  subscribe: (listener: (event: LaqiEvent) => void) => () => void
  getLanguages: () => Promise<{ name: string; displayName: string }[]>
  getTypes: (
    id: string,
    options: { response?: string; lang?: string },
  ) => Promise<
    | {
        ok: true
        code: string
        language: string
        /**
         * Where the printed types came from. A schema states what the
         * response may contain; a body is one sample, and what was inferred
         * from it is a guess. The panel says which, always.
         */
        origin: 'schema' | 'body'
        diagnostics?: Diagnostic[]
      }
    | { ok: false; error: string; code: WriteFailure }
  >
  generateData: (input: GenerateRequest) => Promise<
      // `typeName` is the declaration the parser generated from. A model file
      // declares several, and which one was picked is the difference between
      // mocking an order and mocking the string 'viewer' — the caller cannot
      // tell from the preview alone. Absent when generating from a response
      // that already exists, where there is no model and no choice to report.
      | {
          ok: true
          preview: unknown
          warnings: string[]
          typeName?: string
          /** Every declaration the source offered, in source order. */
          candidates?: string[]
          /**
           * The schema the preview was generated from, and the evidence that
           * reproduces it. The caller saves both beside the body it keeps.
           */
          schema?: SchemaSnapshot
          generation?: GenerationEvidence
          /** What the import approximated or noted, replayed on every later read. */
          diagnostics?: Diagnostic[]
        }
      | {
          ok: false
          error: string
          code: WriteFailure
          /** Present when the refusal was a loss the caller may acknowledge. */
          diagnostics?: Diagnostic[]
        }
  >
  importSchema: (input: {
    source: unknown
    allowLoss?: boolean
  }) => Promise<
    | { ok: true; snapshot: SchemaSnapshot }
    | { ok: false; error: string; code: WriteFailure; diagnostics?: Diagnostic[] }
  >
  previewBody: (input: {
    snapshot: unknown
    seed?: number
    arrayLength?: number
  }) => Promise<
    | { ok: true; body: unknown; evidence: GenerationEvidence; diagnostics: Diagnostic[] }
    | { ok: false; error: string; code: WriteFailure; diagnostics?: Diagnostic[] }
  >
  /**
   * Generates from the response's STORED schema. Writes nothing: the caller
   * looks at what came back and decides, and `revision` is what it hands to
   * `applyGeneratedBody` when it does.
   */
  regenerateResponse: (
    id: string,
    response: string | undefined,
    options: { seed?: number; arrayLength?: number },
  ) => Promise<
    | {
        ok: true
        body: unknown
        evidence: GenerationEvidence
        diagnostics: Diagnostic[]
        revision: string
      }
    | { ok: false; error: string; code: WriteFailure }
  >
  applyGeneratedBody: (
    id: string,
    response: string | undefined,
    input: { body: unknown; evidence: unknown; revision: string; confirm?: boolean },
  ) =>
    | { ok: true; revision: string }
    | {
        ok: false
        error: string
        code: WriteFailure
        conflict?: { reason: string; revision: string }
      }
  /** Re-reads the source and replaces the schema. Never touches the body. */
  refreshResponseSchema: (
    id: string,
    response: string | undefined,
    input: { revision: string; allowLoss?: boolean },
  ) => Promise<
    | { ok: true; snapshot: SchemaSnapshot; revision: string }
    | {
        ok: false
        error: string
        code: WriteFailure
        diagnostics?: Diagnostic[]
        conflict?: { reason: string; revision: string }
      }
  >
}

const ImportRequestSchema = z.object({
  source: z.looseObject({ kind: z.string().min(1) }),
  allowLoss: z.boolean().optional(),
})

const PreviewRequestSchema = z.object({
  snapshot: z.unknown(),
  seed: z.number().int().optional(),
  arrayLength: z.number().int().optional(),
})

const RegenerateRequestSchema = z.object({
  seed: z.number().int().optional(),
  arrayLength: z.number().int().optional(),
})

const ApplyBodyRequestSchema = z.object({
  body: z.unknown(),
  evidence: z.unknown(),
  revision: z.string().min(1),
  confirm: z.boolean().optional(),
})

const RefreshSchemaRequestSchema = z.object({
  revision: z.string().min(1),
  allowLoss: z.boolean().optional(),
})

export function createControlPlaneApp(runtime: ControlPlaneRuntime): Hono {
  const app = new Hono()

  // A POST with Content-Type: text/plain is a CORS "simple request" — a
  // browser sends it WITHOUT preflight — and c.req.json() parses it anyway
  // without looking at the declared content-type. Without this, any tab
  // open on another site could silently write to the developer's project.
  // No Origin header (curl, same-origin fetch) passes just the same: only
  // a cross-origin browser always sends Origin.
  app.use('*', async (c, next) => {
    const origin = c.req.header('Origin')
    const isWriteMethod = ['POST', 'PUT', 'DELETE'].includes(c.req.method)

    if (isWriteMethod && origin) {
      let allowed = false
      try {
        const parsed = new URL(origin)
        allowed =
          parsed.protocol === 'http:' &&
          ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)
      } catch {
        allowed = false
      }
      if (!allowed) {
        return c.json({ error: 'laqi-control-plane', message: 'cross-origin write rejected' }, 403)
      }
    }

    await next()
  })

  app.get('/api/endpoints', (c) => c.json(runtime.getEndpoints()))

  app.get('/api/state', (c) => c.json(runtime.getState()))

  app.put('/api/state', async (c) => {
    let raw: unknown
    try {
      raw = await c.req.json()
    } catch {
      return c.json({ error: 'laqi-control-plane', message: 'body is not valid JSON' }, 400)
    }

    const parsed = StateSchema.safeParse(raw)
    if (!parsed.success) {
      return c.json(
        {
          error: 'laqi-control-plane',
          message: parsed.error.issues.map((i) => i.message).join('; '),
        },
        400,
      )
    }

    // StateSchema only checks shape — `scenario` is `string | null` and
    // `overrides` is `Record<string, string>`, so any name passes the parse.
    // Without this, a typo'd scenario (or an override naming an endpoint
    // that was never loaded) gets a 200 and is stored, and the caller
    // believes it is active while every request quietly falls through to
    // its default. `Project.setScenario`/`setResponse` already reject these
    // the same way; this mirrors that here so both writers of state.json
    // agree on what's valid.
    if (parsed.data.scenario !== null) {
      const scenarios = runtime.getScenarios()
      if (!Object.hasOwn(scenarios, parsed.data.scenario)) {
        const available = Object.keys(scenarios)
        return c.json(
          {
            error: 'laqi-control-plane',
            message:
              available.length === 0
                ? 'no scenarios are declared — add a scenarios.json next to your mocks'
                : `unknown scenario ${JSON.stringify(parsed.data.scenario)}. Available: ${available.join(', ')}`,
          },
          400,
        )
      }
    }

    const endpointsById = new Map(runtime.getEndpoints().map((endpoint) => [endpoint.id, endpoint]))
    for (const [id, response] of Object.entries(parsed.data.overrides)) {
      const endpoint = endpointsById.get(id)
      if (endpoint === undefined) {
        const ids = [...endpointsById.keys()]
        return c.json(
          {
            error: 'laqi-control-plane',
            message:
              ids.length === 0
                ? `no endpoints are loaded — cannot override ${JSON.stringify(id)}`
                : `no endpoint with id ${JSON.stringify(id)} — known ids: ${ids.slice(0, 12).join(', ')}`,
          },
          400,
        )
      }
      if (!Object.hasOwn(endpoint.responses, response)) {
        return c.json(
          {
            error: 'laqi-control-plane',
            message: `${JSON.stringify(response)} is not declared on ${id}. Available: ${Object.keys(endpoint.responses).join(', ')}`,
          },
          400,
        )
      }
    }

    runtime.setState(parsed.data)
    return c.json(parsed.data)
  })

  app.get('/api/scenarios', (c) => c.json(runtime.getScenarios()))

  app.get('/api/status', (c) => c.json(runtime.getStatus()))

  app.post('/api/endpoints', async (c) => {
    let raw: unknown
    try {
      raw = await c.req.json()
    } catch {
      return c.json({ error: 'laqi-control-plane', message: 'body is not valid JSON' }, 400)
    }

    if (typeof raw !== 'object' || raw === null) {
      return c.json({ error: 'laqi-control-plane', message: 'body must be an object' }, 400)
    }
    const input = raw as Record<string, unknown>

    if (typeof input.method !== 'string' || !isHttpMethod(input.method.toUpperCase())) {
      return c.json(
        { error: 'laqi-control-plane', message: `unknown method ${JSON.stringify(input.method)}` },
        400,
      )
    }
    if (typeof input.path !== 'string' || !input.path.startsWith('/')) {
      return c.json({ error: 'laqi-control-plane', message: 'path must start with "/"' }, 400)
    }
    if (input.path === RESERVED_PREFIX || input.path.startsWith(`${RESERVED_PREFIX}/`)) {
      return c.json(
        {
          error: 'laqi-control-plane',
          message: `${RESERVED_PREFIX} is reserved by the laqi control panel and cannot be mocked`,
        },
        400,
      )
    }

    const definition = EndpointSchema.safeParse({
      description: input.description,
      default: input.default,
      responses: input.responses,
    })
    if (!definition.success) {
      return c.json(
        {
          error: 'laqi-control-plane',
          message: definition.error.issues.map((i) => i.message).join('; '),
        },
        400,
      )
    }

    const result = runtime.createEndpoint({
      method: input.method.toUpperCase() as HttpMethod,
      path: input.path,
      description: definition.data.description,
      default: definition.data.default,
      responses: definition.data.responses,
    })

    if (!result.ok) {
      // 409 only when it truly clashes with something. A malformed path
      // that Project rejects is a 400: it doesn't conflict with anything,
      // and a client that treats 409 as "already exists" would get confused.
      return c.json(
        { error: 'laqi-control-plane', message: result.error },
        STATUS[result.code ?? 'conflict'],
      )
    }

    return c.json({ id: result.id }, 201)
  })

  app.put('/api/endpoints/:id', async (c) => {
    // No decodeURIComponent: Hono already decodes the param. Decoding it
    // again breaks any id with a literal '%' — encodeURIComponent sends it
    // as %25, Hono returns it as '%', and the second decode throws
    // URIError, i.e. a 500 instead of editing the endpoint.
    const id = c.req.param('id')

    let raw: unknown
    try {
      raw = await c.req.json()
    } catch {
      return c.json({ error: 'laqi-control-plane', message: 'body is not valid JSON' }, 400)
    }

    const definition = EndpointSchema.safeParse(raw)
    if (!definition.success) {
      return c.json(
        {
          error: 'laqi-control-plane',
          message: definition.error.issues.map((i) => i.message).join('; '),
        },
        400,
      )
    }

    const result = runtime.updateEndpoint(id, definition.data)
    if (!result.ok) {
      return c.json(
        { error: 'laqi-control-plane', message: result.error },
        STATUS[result.code ?? 'not-found'],
      )
    }

    return c.json({ ok: true })
  })

  app.delete('/api/endpoints/:id', (c) => {
    // See the comment on PUT: Hono already decoded it.
    const id = c.req.param('id')
    const result = runtime.deleteEndpoint(id)

    if (!result.ok) {
      return c.json(
        { error: 'laqi-control-plane', message: result.error },
        STATUS[result.code ?? 'not-found'],
      )
    }

    return c.body(null, 204)
  })

  app.get('/events', (c) =>
    streamSSE(c, async (stream) => {
      // No busy-loop: the generator just waits on this promise, which
      // resolves the exact moment the client disconnects. There used to be
      // a `while (!closed) await stream.sleep(30)`, which woke a timer
      // 33 times per second per connection just to check a flag.
      const disconnected = new Promise<void>((resolve) => {
        stream.onAbort(() => resolve())
      })

      const unsubscribe = runtime.subscribe((event) => {
        void stream.writeSSE({ event: event.type, data: JSON.stringify(event) })
      })

      try {
        await disconnected
      } finally {
        unsubscribe()
      }
    }),
  )

  app.get('/api/generate/languages', async (c) => c.json(await runtime.getLanguages()))

  app.get('/api/endpoints/:id/types', async (c) => {
    const id = c.req.param('id') // Hono already decoded the param — no extra decode.
    const result = await runtime.getTypes(id, {
      response: c.req.query('response'),
      lang: c.req.query('lang'),
    })
    if (!result.ok) {
      return c.json({ error: 'laqi-control-plane', message: result.error }, STATUS[result.code])
    }
    return c.json({
      code: result.code,
      language: result.language,
      origin: result.origin,
      ...(result.diagnostics === undefined ? {} : { diagnostics: result.diagnostics }),
    })
  })

  app.post('/api/generate/data', async (c) => {
    let raw: unknown
    try {
      raw = await c.req.json()
    } catch {
      return c.json({ error: 'laqi-control-plane', message: 'body is not valid JSON' }, 400)
    }

    // We pick the branch by the discriminant key BEFORE parsing, and
    // validate only against that branch's schema. If we handed both to a
    // z.union, the only issue that comes out is the generic invalid_union
    // ("Invalid input") — the branch-specific detail (which field is
    // missing, what type it had) stays buried inside and never reaches the
    // user. A present `model` (of any type) wins over `from`, same as
    // before.
    const body = raw as Record<string, unknown>
    const hasModel = typeof body === 'object' && body !== null && 'model' in body
    const hasFrom = typeof body === 'object' && body !== null && 'from' in body

    if (!hasModel && !hasFrom) {
      return c.json(
        {
          error: 'laqi-control-plane',
          message: 'body needs either "model" (TS source) or "from" ({endpointId, response})',
        },
        400,
      )
    }

    const parsed = hasModel ? ModelVariantSchema.safeParse(raw) : FromVariantSchema.safeParse(raw)
    if (!parsed.success) {
      return c.json(
        { error: 'laqi-control-plane', message: issuesToMessage(parsed.error.issues) },
        400,
      )
    }

    const result = await runtime.generateData(parsed.data)
    if (!result.ok) {
      // The diagnostics ride on the refusal: a caller deciding whether to
      // acknowledge an approximation needs to see it without asking twice.
      return c.json(
        {
          error: 'laqi-control-plane',
          message: result.error,
          ...(result.diagnostics === undefined ? {} : { diagnostics: result.diagnostics }),
        },
        STATUS[result.code],
      )
    }
    return c.json({
      preview: result.preview,
      warnings: result.warnings,
      ...(result.typeName === undefined
        ? {}
        : { typeName: result.typeName, candidates: result.candidates ?? [result.typeName] }),
      ...(result.schema === undefined ? {} : { schema: result.schema }),
      ...(result.generation === undefined ? {} : { generation: result.generation }),
      ...(result.diagnostics === undefined ? {} : { diagnostics: result.diagnostics }),
    })
  })

  /**
   * Reads a JSON body, or says so. Every route below needs the same three
   * lines, and a missing one is a 500 nobody can act on.
   */
  const readJson = async (c: {
    req: { json: () => Promise<unknown> }
  }): Promise<{ ok: true; value: unknown } | { ok: false }> => {
    try {
      return { ok: true, value: await c.req.json() }
    } catch {
      return { ok: false }
    }
  }

  /**
   * A refusal the caller can act on. Diagnostics mean laqi understood the
   * request and refuses what it says (422); no diagnostics means it could
   * not read the request at all (the code's own status).
   */
  const refusal = (result: {
    error: string
    code: WriteFailure
    diagnostics?: Diagnostic[]
    conflict?: { reason: string; revision: string }
  }) =>
    ({
      payload: {
        error: 'laqi-control-plane',
        message: result.error,
        ...(result.diagnostics === undefined ? {} : { diagnostics: result.diagnostics }),
        ...(result.conflict === undefined
          ? {}
          : { reason: result.conflict.reason, revision: result.conflict.revision }),
      },
      status:
        result.diagnostics !== undefined && result.code === 'invalid' ? 422 : STATUS[result.code],
    }) as const

  app.post('/api/schema/import', async (c) => {
    const raw = await readJson(c)
    if (!raw.ok) {
      return c.json({ error: 'laqi-control-plane', message: 'body is not valid JSON' }, 400)
    }

    const parsed = ImportRequestSchema.safeParse(raw.value)
    if (!parsed.success) {
      return c.json(
        { error: 'laqi-control-plane', message: issuesToMessage(parsed.error.issues) },
        400,
      )
    }

    const result = await runtime.importSchema(parsed.data)
    if (!result.ok) {
      const { payload, status } = refusal(result)
      return c.json(payload, status)
    }
    return c.json({ snapshot: result.snapshot })
  })

  app.post('/api/schema/preview', async (c) => {
    const raw = await readJson(c)
    if (!raw.ok) {
      return c.json({ error: 'laqi-control-plane', message: 'body is not valid JSON' }, 400)
    }

    const parsed = PreviewRequestSchema.safeParse(raw.value)
    if (!parsed.success) {
      return c.json(
        { error: 'laqi-control-plane', message: issuesToMessage(parsed.error.issues) },
        400,
      )
    }

    const result = await runtime.previewBody(parsed.data)
    if (!result.ok) {
      const { payload, status } = refusal(result)
      return c.json(payload, status)
    }
    return c.json({ body: result.body, evidence: result.evidence, diagnostics: result.diagnostics })
  })

  app.post('/api/endpoints/:id/responses/:name/regenerate', async (c) => {
    const raw = await readJson(c)
    // An empty body is a legitimate regenerate: no seed, no length, defaults.
    const parsed = RegenerateRequestSchema.safeParse(raw.ok ? (raw.value ?? {}) : {})
    if (!parsed.success) {
      return c.json(
        { error: 'laqi-control-plane', message: issuesToMessage(parsed.error.issues) },
        400,
      )
    }

    const result = await runtime.regenerateResponse(
      c.req.param('id'),
      c.req.param('name'),
      parsed.data,
    )
    if (!result.ok) {
      const { payload, status } = refusal(result)
      return c.json(payload, status)
    }
    return c.json({
      body: result.body,
      evidence: result.evidence,
      diagnostics: result.diagnostics,
      revision: result.revision,
    })
  })

  app.put('/api/endpoints/:id/responses/:name/body', async (c) => {
    const raw = await readJson(c)
    if (!raw.ok) {
      return c.json({ error: 'laqi-control-plane', message: 'body is not valid JSON' }, 400)
    }

    const parsed = ApplyBodyRequestSchema.safeParse(raw.value)
    if (!parsed.success) {
      return c.json(
        { error: 'laqi-control-plane', message: issuesToMessage(parsed.error.issues) },
        400,
      )
    }

    const result = runtime.applyGeneratedBody(c.req.param('id'), c.req.param('name'), parsed.data)
    if (!result.ok) {
      const { payload, status } = refusal(result)
      return c.json(payload, status)
    }
    return c.json({ revision: result.revision })
  })

  app.post('/api/endpoints/:id/responses/:name/schema/refresh', async (c) => {
    const raw = await readJson(c)
    if (!raw.ok) {
      return c.json({ error: 'laqi-control-plane', message: 'body is not valid JSON' }, 400)
    }

    const parsed = RefreshSchemaRequestSchema.safeParse(raw.value)
    if (!parsed.success) {
      return c.json(
        { error: 'laqi-control-plane', message: issuesToMessage(parsed.error.issues) },
        400,
      )
    }

    const result = await runtime.refreshResponseSchema(
      c.req.param('id'),
      c.req.param('name'),
      parsed.data,
    )
    if (!result.ok) {
      const { payload, status } = refusal(result)
      return c.json(payload, status)
    }
    return c.json({ snapshot: result.snapshot, revision: result.revision })
  })

  // Insertion point for future routes: they go HERE, before this
  // catch-all — never after.
  app.all('*', (c) =>
    c.json({ error: 'laqi-control-plane', message: 'no matching route', path: c.req.path }, 404),
  )

  return app
}
