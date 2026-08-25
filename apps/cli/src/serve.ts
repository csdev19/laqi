// apps/cli/src/serve.ts
import { join } from 'node:path'
import { serve, type ServerType } from '@hono/node-server'
import {
  createEndpointInFile,
  deleteEndpointFromFile,
  EventBus,
  StateStore,
  updateEndpointInFile,
  type WriteResult,
} from '@laqi/core'
import {
  formatEndpointId,
  isHttpMethod,
  type EndpointDefinition,
  type HttpMethod,
  type LaqiConfig,
} from '@laqi/schema'
import { createControlPlaneApp, createMockApp, type ControlPlaneRuntime } from '@laqi/server'
import { Hono } from 'hono'
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
  const bus = new EventBus()

  let runtime = buildRuntime(root, config)
  let app: Hono = buildApp()

  function reload(): Runtime {
    runtime = buildRuntime(root, config)
    app = buildApp()
    bus.emit({ type: 'endpoints-changed', endpointCount: runtime.table.endpoints.length })
    for (const error of runtime.errors) {
      bus.emit({
        type: 'error',
        file: error.file,
        line: error.line,
        col: error.col,
        message: error.message,
        excerpt: error.excerpt,
      })
    }
    return runtime
  }

  function targetFileForNewEndpoint(): string {
    return runtime.source === 'file' ? config.file : join(config.dir, 'api.json')
  }

  function buildApp(): Hono {
    const mockApp = createMockApp({
      table: runtime.table,
      scenarios: runtime.scenarios,
      // Se lee en cada request: el panel cambia el estado sin tocar archivos.
      getState: () => store.read(),
      cors: config.cors,
      onRequest: (event) => bus.emit(event),
    })

    const controlPlaneRuntime: ControlPlaneRuntime = {
      getEndpoints: () => runtime.table.endpoints,
      getState: () => store.read(),
      setState: (state) => store.write(state),
      getScenarios: () => runtime.scenarios,
      getStatus: () => ({
        watching: runtime.source === 'file' ? config.file : config.dir,
        endpointCount: runtime.table.endpoints.length,
        address: `${config.host}:${config.port}`,
        errors: runtime.errors,
      }),
      createEndpoint: (input) => {
        const method = input.method.toUpperCase()
        if (!isHttpMethod(method)) return { ok: false, error: `unknown method ${JSON.stringify(input.method)}` }

        const id = formatEndpointId(method as HttpMethod, input.path)
        const result: WriteResult = createEndpointInFile({
          root,
          file: targetFileForNewEndpoint(),
          id,
          // `responses` llega tipado como `Record<string, unknown>` desde el
          // contrato de ControlPlaneRuntime (para no acoplar @laqi/server a
          // @laqi/schema's EndpointDefinition), pero ya fue validado por
          // EndpointSchema antes de llegar aquí (control-plane-app.ts) y se
          // vuelve a validar dentro de createEndpointInFile — el cast sólo
          // reconcilia los dos contratos de tipos, no evita la validación.
          definition: {
            description: input.description,
            default: input.default,
            responses: input.responses,
          } as EndpointDefinition,
        })

        if (!result.ok) return result
        reload()
        return { ok: true, id }
      },
      updateEndpoint: (id, definition) => {
        const existing = runtime.table.byId.get(id)
        if (!existing) return { ok: false, error: `no endpoint with id ${JSON.stringify(id)}` }

        // Mismo reconciliado de tipos que en createEndpoint (ver comentario
        // arriba): ya validado por EndpointSchema en control-plane-app.ts.
        const result = updateEndpointInFile({
          root,
          file: existing.file,
          id,
          definition: definition as EndpointDefinition,
        })
        if (result.ok) reload()
        return result
      },
      deleteEndpoint: (id) => {
        const existing = runtime.table.byId.get(id)
        if (!existing) return { ok: false, error: `no endpoint with id ${JSON.stringify(id)}` }

        const result = deleteEndpointFromFile({ root, file: existing.file, id })
        if (result.ok) reload()
        return result
      },
      subscribe: (listener) => bus.subscribe(listener),
    }
    const controlPlaneApp = createControlPlaneApp(controlPlaneRuntime)

    const top = new Hono()
    top.route('/__laqi', controlPlaneApp)
    top.route('/', mockApp)
    return top
  }

  const server: ServerType = await new Promise((resolve, reject) => {
    const instance = serve(
      {
        // La indirección es el punto: `app` es mutable, el servidor no.
        fetch: (request: Request) => app.fetch(request),
        port: config.port,
        hostname: config.host,
      },
      () => resolve(instance),
    )
    // Sin esto, un puerto ocupado (EADDRINUSE) nunca dispara el callback de
    // éxito y la promesa cuelga para siempre, en silencio.
    instance.on('error', reject)
  })

  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : config.port

  return {
    port,
    host: config.host,
    current: () => runtime,
    reload,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      }),
  }
}
