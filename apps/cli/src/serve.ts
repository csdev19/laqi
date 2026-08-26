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
import {
  createControlPlaneApp,
  createMockApp,
  createPublicApp,
  type ControlPlaneRuntime,
} from '@laqi/server'
import { Hono } from 'hono'
import { createEditorApp } from './editor-assets'
import { buildRuntime, type Runtime } from './runtime'

/**
 * Lo que hace falta para levantar la superficie pública. Es un SEGUNDO
 * listener, no una ruta del primero: el control plane no se monta ahí, así
 * que el túnel no puede alcanzarlo ni equivocándose. Ésa es la resolución
 * estructural del hallazgo H1.
 */
export type ShareOptions = {
  port: number
  /** `null` sólo con --public, y ya se advirtió. */
  token: string | null
  origins: string[]
}

export type ServeHandle = {
  port: number
  host: string
  /** El puerto local al que apunta el túnel, si --share está activo. */
  publicPort?: number
  /** Reconstruye la app Hono. El proceso y el socket NO se tocan. */
  reload: () => Runtime
  current: () => Runtime
  /** Lo que el panel muestra en la banda magenta. */
  setShareUrl: (url: string | null) => void
  close: () => Promise<void>
}

export async function startServer(options: {
  root: string
  config: LaqiConfig
  share?: ShareOptions
}): Promise<ServeHandle> {
  const { root, config, share } = options
  let shareUrl: string | null = null
  const store = new StateStore(root)
  const bus = new EventBus()

  let runtime = buildRuntime(root, config)
  let app: Hono = buildApp()
  // Se reconstruye en cada reload igual que la local: el hot-reload tiene
  // que valer también para lo que sale por el túnel.
  let publicApp: Hono | null = share ? buildPublicApp(share) : null

  function reload(): Runtime {
    runtime = buildRuntime(root, config)
    app = buildApp()
    if (share) publicApp = buildPublicApp(share)
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

  function buildPublicApp(options: ShareOptions): Hono {
    return createPublicApp({
      mock: {
        table: runtime.table,
        scenarios: runtime.scenarios,
        getState: () => store.read(),
        onRequest: (event) => bus.emit(event),
      },
      token: options.token,
      origins: options.origins,
    })
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
        share: share
          ? {
              url: shareUrl,
              // El token viaja al panel a propósito: es local-only y es
              // donde el developer lo va a copiar.
              token: share.token,
              // Lo que el hallazgo H1 pide hacer visible: la garantía deja
              // de ser invisible y pasa a estar escrita en la banda.
              exposed: 'mocks only — the panel and the control plane are not exposed',
            }
          : null,
      }),
      createEndpoint: (input) => {
        const method = input.method.toUpperCase()
        if (!isHttpMethod(method)) return { ok: false, error: `unknown method ${JSON.stringify(input.method)}` }

        const id = formatEndpointId(method as HttpMethod, input.path)

        // createEndpointInFile sólo detecta un id duplicado DENTRO del
        // archivo destino — en modo carpeta, todo endpoint nuevo va a
        // laqi/api.json, así que un id que ya existe en OTRO archivo se
        // escribiría igual, y buildRouteTable rechazaría ambos lados como
        // colisión (correcto de su parte) dejando el endpoint preexistente
        // muerto también. Hay que rechazar ACÁ, antes de escribir.
        if (runtime.table.byId.has(id)) {
          const existing = runtime.table.byId.get(id)!
          return { ok: false, error: `${JSON.stringify(id)} already exists in ${existing.file}` }
        }

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
    // El panel y el control plane sólo se montan cuando el server escucha en
    // loopback — con --host 0.0.0.0 (la feature intencional de LAN/mobile
    // testing de un plan anterior) montarlos acá los expondría a cualquiera
    // en la red local. Sin estos mounts, /__laqi/* simplemente cae al 404 del
    // mock app, como cualquier otra ruta no encontrada.
    if (config.host === '127.0.0.1' || config.host === 'localhost') {
      // El panel va PRIMERO: el control plane termina en un catch-all que
      // se comería /__laqi y /__laqi/assets/*.
      top.route('/', createEditorApp())
      top.route('/__laqi', controlPlaneApp)
    }
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

  let publicServer: ServerType | null = null
  let publicPort: number | undefined

  if (share) {
    publicServer = await new Promise<ServerType>((resolve, reject) => {
      const instance = serve(
        {
          fetch: (request: Request) => publicApp!.fetch(request),
          port: share.port,
          // Loopback también: cloudflared corre en esta máquina y se conecta
          // localmente. Bindear a 0.0.0.0 expondría la superficie pública a
          // la LAN además del túnel, sin que nadie lo haya pedido.
          hostname: '127.0.0.1',
        },
        () => resolve(instance),
      )
      instance.on('error', reject)
    })

    const publicAddress = publicServer.address()
    publicPort = typeof publicAddress === 'object' && publicAddress ? publicAddress.port : share.port
  }

  return {
    port,
    host: config.host,
    publicPort,
    current: () => runtime,
    reload,
    setShareUrl: (url) => {
      shareUrl = url
    },
    close: async () => {
      await Promise.all(
        [server, publicServer].filter((instance) => instance !== null).map(
          (instance) =>
            new Promise<void>((resolve, reject) => {
              instance.close((error) => (error ? reject(error) : resolve()))
            }),
        ),
      )
    },
  }
}
