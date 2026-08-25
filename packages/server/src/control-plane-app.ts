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

/**
 * Todo lo que el control plane necesita del proceso que lo hospeda. Cada
 * tarea de este plan agrega los campos que sus rutas necesitan — este tipo
 * es el contrato completo recién al final de la Tarea 8.
 */
export type ControlPlaneRuntime = {
  getEndpoints: () => LoadedEndpoint[]
  getState: () => LaqiState
  setState: (state: LaqiState) => void
  getScenarios: () => Scenarios
  getStatus: () => { watching: string; endpointCount: number; address: string; errors: LoadError[] }
  createEndpoint: (input: {
    method: HttpMethod
    path: string
    description?: string
    default: string
    responses: Record<string, unknown>
  }) => { ok: true; id: string } | { ok: false; error: string }
  updateEndpoint: (
    id: string,
    definition: { description?: string; default: string; responses: Record<string, unknown> },
  ) => { ok: true } | { ok: false; error: string }
  deleteEndpoint: (id: string) => { ok: true } | { ok: false; error: string }
  subscribe: (listener: (event: LaqiEvent) => void) => () => void
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
      return c.json({ error: 'laqi-control-plane', message: result.error }, 409)
    }

    return c.json({ id: result.id }, 201)
  })

  app.put('/api/endpoints/:id', async (c) => {
    const id = decodeURIComponent(c.req.param('id'))

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
      return c.json({ error: 'laqi-control-plane', message: result.error }, 404)
    }

    return c.json({ ok: true })
  })

  app.delete('/api/endpoints/:id', (c) => {
    const id = decodeURIComponent(c.req.param('id'))
    const result = runtime.deleteEndpoint(id)

    if (!result.ok) {
      return c.json({ error: 'laqi-control-plane', message: result.error }, 404)
    }

    return c.body(null, 204)
  })

  app.get('/events', (c) =>
    streamSSE(c, async (stream) => {
      let closed = false
      stream.onAbort(() => {
        closed = true
      })

      const unsubscribe = runtime.subscribe((event) => {
        void stream.writeSSE({ event: event.type, data: JSON.stringify(event) })
      })

      try {
        // 30ms, no 1000ms: el loop existe sólo para mantener vivo el
        // generador mientras la conexión sigue abierta; el intervalo es la
        // latencia máxima antes de notar un abort y desuscribirse. Verificado
        // durante la ejecución: a 1000ms, el test de desconexión (que sólo
        // espera 150ms tras el cancel) fallaba de forma determinista aunque
        // onAbort disparaba correctamente — el cleanup real ocurría, sólo
        // que tarde.
        // oxlint-disable-next-line no-unmodified-loop-condition -- `closed` is set from stream.onAbort()'s callback, not visible to this lint rule
        while (!closed) {
          await stream.sleep(30)
        }
      } finally {
        unsubscribe()
      }
    }),
  )

  // Punto de inserción para futuras rutas: van ACÁ, antes de este
  // catch-all — nunca después.
  app.all('*', (c) =>
    c.json({ error: 'laqi-control-plane', message: 'no matching route', path: c.req.path }, 404),
  )

  return app
}
