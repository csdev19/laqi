import type { LaqiEvent, LoadedEndpoint, LoadError } from '@laqi/core'
import {
  EndpointSchema,
  isHttpMethod,
  RESERVED_PREFIX,
  StateSchema,
  type HttpMethod,
  type LaqiState,
  type Scenarios,
} from '@laqi/schema'
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { z } from 'zod'

/**
 * Todo lo que el control plane necesita del proceso que lo hospeda. Cada
 * tarea de este plan agrega los campos que sus rutas necesitan — este tipo
 * es el contrato completo recién al final de la Tarea 8.
 */
/** Por qué falló una escritura, para elegir el status correcto. */
export type WriteFailure = 'invalid' | 'conflict' | 'not-found'

const STATUS: Record<WriteFailure, 400 | 404 | 409> = {
  invalid: 400,
  conflict: 409,
  'not-found': 404,
}

export type GenerateRequest =
  | { model: string; typeName?: string; arrayLength?: number; seed?: number }
  | { from: { endpointId: string; response: string }; arrayLength?: number; seed?: number }

const GenerateBodySchema = z.union([
  z.object({
    model: z.string().min(1),
    typeName: z.string().optional(),
    arrayLength: z.number().int().optional(),
    seed: z.number().int().optional(),
  }),
  z.object({
    from: z.object({ endpointId: z.string(), response: z.string() }),
    arrayLength: z.number().int().optional(),
    seed: z.number().int().optional(),
  }),
])

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
    /** `null` cuando --share no está activo. */
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
  ) => Promise<{ ok: true; code: string; language: string } | { ok: false; error: string; code: WriteFailure }>
  generateData: (
    input: GenerateRequest,
  ) => Promise<{ ok: true; preview: unknown; warnings: string[] } | { ok: false; error: string; code: WriteFailure }>
}

export function createControlPlaneApp(runtime: ControlPlaneRuntime): Hono {
  const app = new Hono()

  // Un POST con Content-Type: text/plain es un CORS "simple request" — un
  // navegador lo manda SIN preflight — y c.req.json() igual lo parsea sin
  // mirar el content-type declarado. Sin esto, cualquier pestaña abierta en
  // otro sitio podría escribir en el proyecto del developer en silencio.
  // Ningún Origin header (curl, fetch same-origin) pasa igual: sólo un
  // navegador cross-origin siempre manda Origin.
  app.use('*', async (c, next) => {
    const origin = c.req.header('Origin')
    const isWriteMethod = ['POST', 'PUT', 'DELETE'].includes(c.req.method)

    if (isWriteMethod && origin) {
      let allowed = false
      try {
        const parsed = new URL(origin)
        allowed = parsed.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)
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
        { error: 'laqi-control-plane', message: parsed.error.issues.map((i) => i.message).join('; ') },
        400,
      )
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
      return c.json({ error: 'laqi-control-plane', message: `unknown method ${JSON.stringify(input.method)}` }, 400)
    }
    if (typeof input.path !== 'string' || !input.path.startsWith('/')) {
      return c.json({ error: 'laqi-control-plane', message: 'path must start with "/"' }, 400)
    }
    if (input.path === RESERVED_PREFIX || input.path.startsWith(`${RESERVED_PREFIX}/`)) {
      return c.json(
        { error: 'laqi-control-plane', message: `${RESERVED_PREFIX} is reserved by the laqi control panel and cannot be mocked` },
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
        { error: 'laqi-control-plane', message: definition.error.issues.map((i) => i.message).join('; ') },
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
      // 409 sólo cuando de verdad choca con algo. Un path mal formado que
      // Project rechaza es un 400: no entra en conflicto con nada, y un
      // cliente que trate 409 como "ya existe" se confundiría.
      return c.json({ error: 'laqi-control-plane', message: result.error }, STATUS[result.code ?? 'conflict'])
    }

    return c.json({ id: result.id }, 201)
  })

  app.put('/api/endpoints/:id', async (c) => {
    // Sin decodeURIComponent: Hono ya decodifica el param. Decodificar otra
    // vez rompe cualquier id con un '%' literal — encodeURIComponent lo
    // manda como %25, Hono lo devuelve como '%', y el segundo decode tira
    // URIError, o sea un 500 en vez de editar el endpoint.
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
        { error: 'laqi-control-plane', message: definition.error.issues.map((i) => i.message).join('; ') },
        400,
      )
    }

    const result = runtime.updateEndpoint(id, definition.data)
    if (!result.ok) {
      return c.json({ error: 'laqi-control-plane', message: result.error }, STATUS[result.code ?? 'not-found'])
    }

    return c.json({ ok: true })
  })

  app.delete('/api/endpoints/:id', (c) => {
    // Ver el comentario del PUT: Hono ya decodificó.
    const id = c.req.param('id')
    const result = runtime.deleteEndpoint(id)

    if (!result.ok) {
      return c.json({ error: 'laqi-control-plane', message: result.error }, STATUS[result.code ?? 'not-found'])
    }

    return c.body(null, 204)
  })

  app.get('/events', (c) =>
    streamSSE(c, async (stream) => {
      // Sin busy-loop: el generador se queda esperando esta promesa, que
      // resuelve en el momento exacto en que el cliente corta. Antes había
      // un `while (!closed) await stream.sleep(30)`, que despertaba un timer
      // 33 veces por segundo por conexión sólo para mirar un flag.
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
    const id = c.req.param('id') // Hono ya lo decodificó — sin decode extra.
    const result = await runtime.getTypes(id, {
      response: c.req.query('response'),
      lang: c.req.query('lang'),
    })
    if (!result.ok) {
      return c.json({ error: 'laqi-control-plane', message: result.error }, STATUS[result.code])
    }
    return c.json({ code: result.code, language: result.language })
  })

  app.post('/api/generate/data', async (c) => {
    let raw: unknown
    try {
      raw = await c.req.json()
    } catch {
      return c.json({ error: 'laqi-control-plane', message: 'body is not valid JSON' }, 400)
    }

    const parsed = GenerateBodySchema.safeParse(raw)
    if (!parsed.success) {
      const body = raw as Record<string, unknown>
      const message =
        typeof body !== 'object' || body === null || (!('model' in body) && !('from' in body))
          ? 'body needs either "model" (TS source) or "from" ({endpointId, response})'
          : parsed.error.issues.map((i) => i.message).join('; ')
      return c.json({ error: 'laqi-control-plane', message }, 400)
    }

    const result = await runtime.generateData(parsed.data)
    if (!result.ok) {
      return c.json({ error: 'laqi-control-plane', message: result.error }, STATUS[result.code])
    }
    return c.json({ preview: result.preview, warnings: result.warnings })
  })

  // Punto de inserción para futuras rutas: van ACÁ, antes de este
  // catch-all — nunca después.
  app.all('*', (c) =>
    c.json({ error: 'laqi-control-plane', message: 'no matching route', path: c.req.path }, 404),
  )

  return app
}
