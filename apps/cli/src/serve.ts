// apps/cli/src/serve.ts
import { serve, type ServerType } from '@hono/node-server'
import { StateStore } from '@laqi/core'
import type { LaqiConfig } from '@laqi/schema'
import { createMockApp } from '@laqi/server'
import type { Hono } from 'hono'
import { buildRuntime, type Runtime } from './runtime'

export type ServeHandle = {
  port: number
  host: string
  /** Reconstruye la app Hono. El proceso y el socket NO se tocan. */
  reload: () => Runtime
  current: () => Runtime
  close: () => Promise<void>
}

export async function startServer(options: {
  root: string
  config: LaqiConfig
}): Promise<ServeHandle> {
  const { root, config } = options
  const store = new StateStore(root)

  let runtime = buildRuntime(root, config)
  let app: Hono = buildApp()

  function buildApp(): Hono {
    return createMockApp({
      table: runtime.table,
      scenarios: runtime.scenarios,
      // Se lee en cada request: el panel cambia el estado sin tocar archivos.
      getState: () => store.read(),
      cors: config.cors,
    })
  }

  const server: ServerType = await new Promise((resolve) => {
    const instance = serve(
      {
        // La indirección es el punto: `app` es mutable, el servidor no.
        fetch: (request: Request) => app.fetch(request),
        port: config.port,
        hostname: config.host,
      },
      () => resolve(instance),
    )
  })

  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : config.port

  return {
    port,
    host: config.host,
    current: () => runtime,
    reload: () => {
      runtime = buildRuntime(root, config)
      app = buildApp()
      return runtime
    },
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      }),
  }
}
