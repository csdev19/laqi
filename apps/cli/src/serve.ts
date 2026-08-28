// apps/cli/src/serve.ts

import { serve, type ServerType } from '@hono/node-server'
import { EventBus, Project, SessionCounters, StateStore, type LaqiEvent } from '@laqi/core'
import type { EndpointDefinition, LaqiConfig } from '@laqi/schema'
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

/**
 * Las direcciones que son sólo esta máquina. `::1` y sus formas escritas
 * cuentan: es loopback IPv6, y dejarlo afuera apagaba el panel en silencio
 * para quien arrancara con `--host ::1`.
 */
export function isLoopback(host: string): boolean {
  const normalised = host.toLowerCase().replace(/^\[|\]$/g, '')
  return (
    normalised === 'localhost' ||
    normalised === '::1' ||
    normalised === '0:0:0:0:0:0:0:1' ||
    // Todo 127.0.0.0/8 es loopback, no sólo 127.0.0.1.
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(normalised)
  )
}

export async function startServer(options: {
  root: string
  config: LaqiConfig
  share?: ShareOptions
  /** Owned by the caller (index.ts), so it survives across reloads and is
   * still readable after the server is closed, for the goodbye summary. */
  counters?: SessionCounters
}): Promise<ServeHandle> {
  const { root, config, share } = options
  const counters = options.counters ?? new SessionCounters()
  let shareUrl: string | null = null
  const store = new StateStore(root)
  const bus = new EventBus()
  const project = new Project(root, config)
  // Shared by both listeners (local and, with --share, the tunnel-facing
  // one): a request is a request regardless of which port answered it, and
  // `recordRequest` is exactly what Task 5 built — an integer increment, no
  // allocation or timing added on this path.
  const recordRequest = (event: LaqiEvent): void => {
    bus.emit(event)
    if (event.type === 'request') counters.recordRequest(event.endpointId !== null)
  }
  // Fuera de buildPublicApp a propósito: la app se reconstruye en cada
  // reload, y si los contadores se reconstruyeran con ella, guardar un
  // archivo local le devolvería la cuota a un cliente limitado en el túnel.
  const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>()

  let runtime = buildRuntime(root, config)
  // Con --port 0 el puerto real lo asigna el SO. Se rellena cuando el
  // listener está arriba; hasta entonces vale el configurado. Sin esto el
  // panel muestra "127.0.0.1:0" y el curl que ofrece copiar no funciona.
  let boundPort = config.port
  let app: Hono = buildApp()
  // Se reconstruye en cada reload igual que la local: el hot-reload tiene
  // que valer también para lo que sale por el túnel.
  let publicApp: Hono | null = share ? buildPublicApp(share) : null

  function reload(): Runtime {
    runtime = buildRuntime(root, config)
    app = buildApp()
    if (share) publicApp = buildPublicApp(share)
    // Un solo evento por recarga. Antes se emitía un `endpoints-changed`
    // MÁS un `error` por archivo roto, y el panel hace un refresh completo
    // por evento: con tres archivos rotos, un guardado disparaba cuatro
    // refreshes y dieciséis GETs. Los errores viajan adentro del evento; el
    // panel igual los relee de /api/status, que es la fuente de verdad.
    bus.emit({
      type: 'endpoints-changed',
      endpointCount: runtime.table.endpoints.length,
      errorCount: runtime.errors.length,
    })
    return runtime
  }

  function buildPublicApp(options: ShareOptions): Hono {
    return createPublicApp({
      buckets: rateLimitBuckets,
      mock: {
        table: runtime.table,
        scenarios: runtime.scenarios,
        getState: () => store.read(),
        onRequest: recordRequest,
      },
      token: options.token,
      origins: options.origins,
    })
  }

  function buildApp(): Hono {
    const mockApp = createMockApp({
      table: runtime.table,
      scenarios: runtime.scenarios,
      // Se lee en cada request: el panel cambia el estado sin tocar archivos.
      getState: () => store.read(),
      cors: config.cors,
      onRequest: recordRequest,
    })

    const controlPlaneRuntime: ControlPlaneRuntime = {
      getEndpoints: () => runtime.table.endpoints,
      getState: () => store.read(),
      // The one door the panel writes response overrides and scenario
      // changes through — a "flip" per Task 7, whichever of the two it was.
      setState: (state) => {
        store.write(state)
        counters.recordFlip()
      },
      getScenarios: () => runtime.scenarios,
      getStatus: () => ({
        watching: runtime.source === 'file' ? config.file : config.dir,
        endpointCount: runtime.table.endpoints.length,
        address: `${config.host}:${boundPort}`,
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
      // Las tres escrituras delegan en Project, que es la MISMA
      // implementación que usa el servidor MCP. Antes había una copia acá
      // que ya había divergido: le faltaba la validación de la clave (un
      // POST con un path inválido escribía un endpoint muerto y devolvía
      // 201) y la limpieza del override al borrar. Una sola implementación
      // no puede driftear.
      createEndpoint: (input) => {
        const result = project.createEndpoint({
          method: input.method,
          path: input.path,
          description: input.description,
          // Ya validado por EndpointSchema en control-plane-app.ts; el cast
          // sólo reconcilia los dos contratos de tipos, y Project lo vuelve
          // a validar antes de escribir.
          default: input.default,
          responses: input.responses as EndpointDefinition['responses'],
        })
        if (!result.ok) return result
        counters.recordWrite(result.value.file)
        reload()
        return { ok: true, id: result.value.id }
      },
      updateEndpoint: (id, definition) => {
        const result = project.updateEndpoint(id, definition as EndpointDefinition)
        if (!result.ok) return result
        counters.recordWrite(result.value.file)
        reload()
        return { ok: true }
      },
      deleteEndpoint: (id) => {
        const result = project.deleteEndpoint(id)
        if (!result.ok) return result
        counters.recordWrite(result.value.file)
        reload()
        return { ok: true }
      },
      subscribe: (listener) => bus.subscribe(listener),
      getLanguages: async () => {
        const { supportedLanguages } = await import('@laqi/generate')
        return supportedLanguages()
      },
      getTypes: async (id, typesOptions) => {
        const endpoint = runtime.table.byId.get(id)
        if (!endpoint)
          return {
            ok: false,
            error: `no endpoint with id ${JSON.stringify(id)}`,
            code: 'not-found',
          }

        const responseName = typesOptions.response ?? endpoint.default
        const response = endpoint.responses[responseName]
        if (!response) {
          return {
            ok: false,
            error: `${JSON.stringify(responseName)} is not declared on ${id}. Available: ${Object.keys(endpoint.responses).join(', ')}`,
            code: 'not-found',
          }
        }

        const { inferShape, printTypes, typeNameFor } = await import('@laqi/generate')
        try {
          // Types are a VIEW of the live data — never persisted, never stale.
          const shape = inferShape(response.body ?? null)
          const printed = await printTypes(shape, {
            typeName: typeNameFor(id),
            lang: typesOptions.lang,
          })
          return { ok: true, ...printed }
        } catch (error) {
          return {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
            code: 'invalid',
          }
        }
      },
      generateData: async (input) => {
        const { generate, inferShape, parseTypes } = await import('@laqi/generate')
        const generateOptions = { seed: input.seed, arrayLength: input.arrayLength }

        // Same shape as getTypes just above: a malformed or unrepresentable
        // model/response is a client problem, not a server crash. Before
        // this, only the not-found checks below were guarded — a deep
        // recursion limit in inferShape or a generation-budget overrun in
        // generate() escaped straight past this callback to Hono's default
        // handler, landing as a bare 500 with no body.
        try {
          if ('model' in input) {
            const parsed = await parseTypes(input.model, input.typeName)
            if (!parsed.ok) return { ok: false, error: parsed.error, code: 'invalid' }
            const preview = await generate(parsed.shape, generateOptions)
            return { ok: true, preview, warnings: parsed.warnings }
          }

          const endpoint = runtime.table.byId.get(input.from.endpointId)
          if (!endpoint) {
            return {
              ok: false,
              error: `no endpoint with id ${JSON.stringify(input.from.endpointId)}`,
              code: 'not-found',
            }
          }
          const response = endpoint.responses[input.from.response]
          if (!response) {
            return {
              ok: false,
              error: `${JSON.stringify(input.from.response)} is not declared on ${input.from.endpointId}`,
              code: 'not-found',
            }
          }
          // Regenerate re-infers from the data the response already has: the
          // original pasted model is never needed again, so it is never stored.
          const preview = await generate(inferShape(response.body ?? null), generateOptions)
          return { ok: true, preview, warnings: [] }
        } catch (error) {
          return {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
            code: 'invalid',
          }
        }
      },
    }
    const controlPlaneApp = createControlPlaneApp(controlPlaneRuntime)

    const top = new Hono()
    // El panel y el control plane sólo se montan cuando el server escucha en
    // loopback — con --host 0.0.0.0 (la feature intencional de LAN/mobile
    // testing de un plan anterior) montarlos acá los expondría a cualquiera
    // en la red local. Sin estos mounts, /__laqi/* simplemente cae al 404 del
    // mock app, como cualquier otra ruta no encontrada.
    if (isLoopback(config.host)) {
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
  boundPort = port

  let publicServer: ServerType | null = null
  let publicPort: number | undefined

  if (share) {
    try {
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
    } catch (error) {
      // El listener principal ya está arriba. Sin cerrarlo, el throw deja un
      // socket huérfano que mantiene vivo el event loop: el CLI dice que
      // falló, no termina nunca, y sigue sirviendo mocks igual.
      await new Promise<void>((resolve) => server.close(() => resolve()))
      // Se marca acá qué listener falló. Deducirlo después leyendo el texto
      // del error se equivocaba en las dos direcciones: bajo Bun el mensaje
      // no trae ":puerto", y bajo Node un puerto que empieza con los mismos
      // dígitos que el otro lo confundía.
      throw Object.assign(error as Error, { laqiListener: 'share' as const })
    }

    const publicAddress = publicServer.address()
    publicPort =
      typeof publicAddress === 'object' && publicAddress ? publicAddress.port : share.port
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
        [server, publicServer]
          .filter((instance) => instance !== null)
          .map(
            (instance) =>
              new Promise<void>((resolve, reject) => {
                instance.close((error) => (error ? reject(error) : resolve()))
                // http.Server#close deja de aceptar conexiones nuevas pero
                // espera a que terminen las abiertas — y el stream de
                // /__laqi/events no termina nunca por su cuenta: vive hasta
                // que el cliente corta. Con el panel abierto en el
                // navegador, close() no resolvía jamás. Cortar las
                // conexiones vivas es lo que hace que termine.
                // El tipo de @hono/node-server es una unión con Http2Server,
                // que no lo declara. En la práctica es siempre un http.Server.
                ;(instance as { closeAllConnections?: () => void }).closeAllConnections?.()
              }),
          ),
      )
    },
  }
}
