import { formatResolvedHeader, resolveResponse, type LoadedEndpoint, type RouteTable } from '@laqi/core'
import type { LaqiConfig, LaqiState, Scenarios } from '@laqi/schema'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { ContentfulStatusCode, StatusCode } from 'hono/utils/http-status'

export type MockRuntime = {
  table: RouteTable
  scenarios: Scenarios
  /** Función, no valor: el estado cambia sin que cambie la tabla de rutas. */
  getState: () => LaqiState
  cors: LaqiConfig['cors']
}

export const RESPONSE_HEADER = 'X-Laqi-Response'
export const SCENARIO_HEADER = 'X-Laqi-Scenario'
export const RESOLVED_HEADER = 'X-Laqi-Resolved'

export function createMockApp(runtime: MockRuntime): Hono {
  const app = new Hono()

  const registerEndpoint = (endpoint: LoadedEndpoint) => {
    app.on(endpoint.method, endpoint.path, async (c) => {
      const resolution = resolveResponse({
        endpoint,
        state: runtime.getState(),
        scenarios: runtime.scenarios,
        headerResponse: c.req.header(RESPONSE_HEADER),
        headerScenario: c.req.header(SCENARIO_HEADER),
      })

      // Un selector inexistente es un 500 explícito. Jamás una request colgada.
      if (!resolution.ok) {
        c.header(RESOLVED_HEADER, formatResolvedHeader(resolution))
        return c.json({ error: 'laqi', endpoint: endpoint.id, message: resolution.message }, 500)
      }

      const { response } = resolution

      if (response.delay) {
        await new Promise((resolve) => setTimeout(resolve, response.delay))
      }

      for (const [name, value] of Object.entries(response.headers ?? {})) {
        c.header(name, value)
      }

      // Se fija DESPUÉS de los headers del mock: uno declarado como
      // "X-Laqi-Resolved" nunca puede mentir sobre la capa que decidió.
      c.header(RESOLVED_HEADER, formatResolvedHeader(resolution))

      if (response.body === undefined) {
        return c.body(null, response.status as StatusCode)
      }

      // structuredClone: el cuerpo servido nunca es la referencia cargada.
      return c.json(structuredClone(response.body), response.status as ContentfulStatusCode)
    })
  }

  // Los endpoints OPTIONS se registran ANTES de cors(): cors() intercepta
  // toda request OPTIONS con un 204 propio antes de que corra cualquier ruta,
  // así que un mock declarado para OPTIONS nunca sería alcanzable si cors()
  // fuera primero.
  for (const endpoint of runtime.table.endpoints) {
    if (endpoint.method === 'OPTIONS') registerEndpoint(endpoint)
  }

  app.use(
    '*',
    cors({
      origin: runtime.cors === '*' ? '*' : runtime.cors,
      allowHeaders: ['Content-Type', 'Authorization', RESPONSE_HEADER, SCENARIO_HEADER],
      exposeHeaders: [RESOLVED_HEADER],
    }),
  )

  for (const endpoint of runtime.table.endpoints) {
    if (endpoint.method !== 'OPTIONS') registerEndpoint(endpoint)
  }

  /** Cap de rutas listadas: útil para un typo, inmanejable con cien endpoints. */
  const MAX_SUGGESTIONS = 20

  app.all('*', (c) =>
    c.json(
      {
        error: 'laqi',
        message: 'no matching route',
        method: c.req.method,
        path: new URL(c.req.url).pathname,
        available: runtime.table.endpoints.slice(0, MAX_SUGGESTIONS).map((e) => e.id),
        totalEndpoints: runtime.table.endpoints.length,
      },
      404,
    ),
  )

  return app
}
