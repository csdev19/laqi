import type { LoadedEndpoint, LoadError } from '@laqi/core'
import { EndpointSchema, isHttpMethod, StateSchema, type HttpMethod, type LaqiState, type Scenarios } from '@laqi/schema'
import { Hono } from 'hono'

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
}

export function createControlPlaneApp(runtime: ControlPlaneRuntime): Hono {
  const app = new Hono()

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

  // Punto de inserción para las tareas 7–8: las rutas nuevas van ACÁ,
  // antes de este catch-all — nunca después.
  app.all('*', (c) =>
    c.json({ error: 'laqi-control-plane', message: 'no matching route', path: c.req.path }, 404),
  )

  return app
}
