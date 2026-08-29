import type { LaqiEvent } from '@laqi/core'
import {
  formatResolvedHeader,
  resolveResponse,
  type LoadedEndpoint,
  type RouteTable,
} from '@laqi/core'
import type { LaqiConfig, LaqiState, Scenarios } from '@laqi/schema'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { ContentfulStatusCode, StatusCode } from 'hono/utils/http-status'

export type MockRuntime = {
  table: RouteTable
  scenarios: Scenarios
  /** A function, not a value: the state changes without the route table changing. */
  getState: () => LaqiState
  cors: LaqiConfig['cors']
  /** Optional: if present, called after resolving each response (success or 500). */
  onRequest?: (event: LaqiEvent) => void
}

export const RESPONSE_HEADER = 'X-Laqi-Response'
export const SCENARIO_HEADER = 'X-Laqi-Scenario'
export const RESOLVED_HEADER = 'X-Laqi-Resolved'

export function createMockApp(runtime: MockRuntime): Hono {
  const app = new Hono()

  const registerEndpoint = (endpoint: LoadedEndpoint) => {
    app.on(endpoint.method, endpoint.path, async (c) => {
      const startedAt = Date.now()
      const resolution = resolveResponse({
        endpoint,
        state: runtime.getState(),
        scenarios: runtime.scenarios,
        headerResponse: c.req.header(RESPONSE_HEADER),
        headerScenario: c.req.header(SCENARIO_HEADER),
      })

      const emit = (status: number) => {
        runtime.onRequest?.({
          type: 'request',
          method: endpoint.method,
          // The requested path, not `endpoint.path`: the log shows what was
          // actually called, otherwise a hundred requests to /users/1..100
          // would all look identical.
          path: new URL(c.req.url).pathname,
          status,
          ms: Date.now() - startedAt,
          endpointId: endpoint.id,
          resolvedName: resolution.name,
          resolvedLayer: resolution.layer,
        })
      }

      // A selector that doesn't exist is an explicit 500. Never a hanging request.
      if (!resolution.ok) {
        c.header(RESOLVED_HEADER, formatResolvedHeader(resolution))
        emit(500)
        return c.json({ error: 'laqi', endpoint: endpoint.id, message: resolution.message }, 500)
      }

      const { response } = resolution

      if (response.delay) {
        await new Promise((resolve) => setTimeout(resolve, response.delay))
      }

      for (const [name, value] of Object.entries(response.headers ?? {})) {
        c.header(name, value)
      }

      // Set AFTER the mock's own headers: one declared as "X-Laqi-Resolved"
      // can never lie about the layer that decided it.
      c.header(RESOLVED_HEADER, formatResolvedHeader(resolution))
      emit(response.status)

      if (response.body === undefined) {
        return c.body(null, response.status as StatusCode)
      }

      // structuredClone: the served body is never the loaded reference.
      return c.json(structuredClone(response.body), response.status as ContentfulStatusCode)
    })
  }

  // OPTIONS endpoints are registered BEFORE cors(): cors() intercepts every
  // OPTIONS request with its own 204 before any route runs, so a mock
  // declared for OPTIONS would never be reachable if cors() came first.
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

  /** Cap on listed routes: useful for a typo, unmanageable with a hundred endpoints. */
  const MAX_SUGGESTIONS = 20

  app.all('*', (c) => {
    const path = new URL(c.req.url).pathname

    // No `endpointId`/`resolved*` because there was no endpoint and no
    // resolution. The panel branches on `endpointId === null` to paint the
    // row red.
    runtime.onRequest?.({
      type: 'request',
      method: c.req.method,
      path,
      status: 404,
      ms: 0,
      endpointId: null,
    })

    return c.json(
      {
        error: 'laqi',
        message: 'no matching route',
        method: c.req.method,
        path,
        available: runtime.table.endpoints.slice(0, MAX_SUGGESTIONS).map((e) => e.id),
        totalEndpoints: runtime.table.endpoints.length,
      },
      404,
    )
  })

  return app
}
