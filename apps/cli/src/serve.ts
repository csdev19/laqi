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
 * What's needed to bring up the public surface. It's a SECOND listener,
 * not a route on the first one: the control plane isn't mounted there, so
 * the tunnel can't reach it even by mistake. That's the structural
 * resolution of finding H1.
 */
export type ShareOptions = {
  port: number
  /** `null` only with --public, and it's already been warned about. */
  token: string | null
  origins: string[]
}

export type ServeHandle = {
  port: number
  host: string
  /** The local port the tunnel points at, while sharing is on. */
  publicPort?: number
  /**
   * Opens the second listener — the one the tunnel sees, mounting only the
   * mocks (ADR-0007). Callable at any time, not just at boot: the `s` key
   * has to work on a process that started without --share, or it would do
   * nothing for half the sessions. Idempotent; resolves to the bound port.
   */
  startPublicListener: (options: ShareOptions) => Promise<number>
  stopPublicListener: () => Promise<void>
  isPublicListening: () => boolean
  /** Rebuilds the Hono app. The process and the socket are NOT touched. */
  reload: () => Runtime
  current: () => Runtime
  /** What the panel shows in the magenta band. */
  setShareUrl: (url: string | null) => void
  close: () => Promise<void>
}

/**
 * The addresses that mean only this machine. `::1` and its written forms
 * count: it's loopback IPv6, and leaving it out silently disabled the
 * panel for anyone starting with `--host ::1`.
 */
export function isLoopback(host: string): boolean {
  const normalised = host.toLowerCase().replace(/^\[|\]$/g, '')
  return (
    normalised === 'localhost' ||
    normalised === '::1' ||
    normalised === '0:0:0:0:0:0:0:1' ||
    // All of 127.0.0.0/8 is loopback, not just 127.0.0.1.
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
  // Kept outside buildPublicApp on purpose: the app is rebuilt on every
  // reload, and if the counters were rebuilt with it, saving a local file
  // would hand the quota back to a client rate-limited over the tunnel.
  const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>()

  let runtime = buildRuntime(root, config)
  // With --port 0 the OS assigns the real port. It gets filled in once
  // the listener is up; until then the configured one holds. Without this
  // the panel shows "127.0.0.1:0" and the curl it offers to copy doesn't work.
  let boundPort = config.port
  let app: Hono = buildApp()
  // Rebuilt on every reload just like the local one: hot-reload has to
  // hold for what goes out through the tunnel too.
  // The options sharing is currently running with. Set at boot by --share,
  // or by the first startPublicListener call, and kept across a stop so a
  // second `s` reuses the token rather than invalidating a URL someone has
  // already pasted into a phone.
  let shareOptions: ShareOptions | undefined = share
  let publicApp: Hono | null = share ? buildPublicApp(share) : null

  function reload(): Runtime {
    runtime = buildRuntime(root, config)
    app = buildApp()
    if (shareOptions) publicApp = buildPublicApp(shareOptions)
    // A single event per reload. It used to emit an `endpoints-changed`
    // PLUS an `error` per broken file, and the panel does a full refresh
    // per event: with three broken files, one save fired four refreshes
    // and sixteen GETs. The errors travel inside the event; the panel
    // still re-reads them from /api/status, which is the source of truth.
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
      // Read on every request: the panel changes state without touching files.
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
              // The token travels to the panel on purpose: it's local-only
              // and it's where the developer is going to copy it from.
              token: share.token,
              // What finding H1 asks to make visible: the guarantee stops
              // being invisible and gets written into the band.
              exposed: 'mocks only — the panel and the control plane are not exposed',
            }
          : null,
      }),
      // All three writes delegate to Project, which is the SAME
      // implementation the MCP server uses. There used to be a copy here
      // that had already diverged: it was missing the key validation (a
      // POST with an invalid path wrote a dead endpoint and returned
      // 201) and the override cleanup on delete. A single implementation
      // can't drift.
      createEndpoint: (input) => {
        const result = project.createEndpoint({
          method: input.method,
          path: input.path,
          description: input.description,
          // Already validated by EndpointSchema in control-plane-app.ts;
          // the cast only reconciles the two type contracts, and Project
          // validates it again before writing.
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
    // The panel and the control plane are only mounted when the server
    // listens on loopback — with --host 0.0.0.0 (the intentional LAN/mobile
    // testing feature from an earlier plan) mounting them here would expose
    // them to anyone on the local network. Without these mounts, /__laqi/*
    // simply falls through to the mock app's 404, like any other unmatched route.
    if (isLoopback(config.host)) {
      // The panel goes FIRST: the control plane ends in a catch-all that
      // would swallow /__laqi and /__laqi/assets/*.
      top.route('/', createEditorApp())
      top.route('/__laqi', controlPlaneApp)
    }
    top.route('/', mockApp)
    return top
  }

  const server: ServerType = await new Promise((resolve, reject) => {
    const instance = serve(
      {
        // The indirection is the point: `app` is mutable, the server isn't.
        fetch: (request: Request) => app.fetch(request),
        port: config.port,
        hostname: config.host,
      },
      () => resolve(instance),
    )
    // Without this, a busy port (EADDRINUSE) never fires the success
    // callback and the promise hangs forever, silently.
    instance.on('error', reject)
  })

  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : config.port
  boundPort = port

  let publicServer: ServerType | null = null
  let publicPort: number | undefined

  /**
   * One way to open the second listener, used by --share at boot and by the
   * `s` key at any point after it. There used to be a single construction
   * site inside the boot branch, which is why the key could not exist.
   */
  const startPublicListener = async (options: ShareOptions): Promise<number> => {
    // Idempotent: pressing `s` twice in quick succession must not bind a
    // second socket and orphan the first.
    if (publicServer !== null) return publicPort ?? options.port

    shareOptions = options
    publicApp = buildPublicApp(options)

    publicServer = await new Promise<ServerType>((resolve, reject) => {
      const instance = serve(
        {
          fetch: (request: Request) => publicApp!.fetch(request),
          port: options.port,
          // Loopback only: cloudflared runs on this machine and connects
          // locally. Binding to 0.0.0.0 would expose the public surface
          // to the LAN as well as the tunnel, without anyone having asked for it.
          hostname: '127.0.0.1',
        },
        () => resolve(instance),
      )
      instance.on('error', reject)
    })

    const publicAddress = publicServer.address()
    publicPort =
      typeof publicAddress === 'object' && publicAddress ? publicAddress.port : options.port
    return publicPort
  }

  const closeListener = (instance: ServerType): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      instance.close((error) => (error ? reject(error) : resolve()))
      // http.Server#close stops accepting new connections but waits for
      // the open ones to finish — and the /__laqi/events stream never ends
      // on its own: it lives until the client cuts it off. With the panel
      // open in the browser, close() never resolved. Cutting the live
      // connections is what makes it terminate.
      // @hono/node-server's type is a union with Http2Server, which
      // doesn't declare it. In practice it's always an http.Server.
      ;(instance as { closeAllConnections?: () => void }).closeAllConnections?.()
    })

  const stopPublicListener = async (): Promise<void> => {
    if (publicServer === null) return
    const instance = publicServer
    // Cleared before awaiting: a second `s` arriving mid-close must see
    // "not listening" rather than try to close the same socket again.
    publicServer = null
    publicPort = undefined
    // shareOptions is deliberately kept, so re-sharing in one session
    // reuses the token instead of invalidating a URL already handed out.
    await closeListener(instance)
  }

  if (share) {
    try {
      await startPublicListener(share)
    } catch (error) {
      // The primary listener is already up. Without closing it, the throw
      // leaves an orphan socket that keeps the event loop alive: the CLI
      // says it failed, never terminates, and keeps serving mocks anyway.
      await new Promise<void>((resolve) => server.close(() => resolve()))
      // Which listener failed is marked here. Deducing it later by
      // reading the error's text got it wrong in both directions: under
      // Bun the message doesn't carry ":port", and under Node a port that
      // starts with the same digits as the other one got confused for it.
      throw Object.assign(error as Error, { laqiListener: 'share' as const })
    }
  }

  return {
    port,
    host: config.host,
    // A getter, not a captured value: sharing can start after this object
    // is built, and index.ts's EADDRINUSE branch reads it afterwards.
    get publicPort() {
      return publicPort
    },
    current: () => runtime,
    reload,
    setShareUrl: (url) => {
      shareUrl = url
    },
    startPublicListener,
    stopPublicListener,
    isPublicListening: () => publicServer !== null,
    close: async () => {
      // The public listener first: leaving it bound after close means the
      // next start hits EADDRINUSE on a port nothing is serving.
      await stopPublicListener()
      await closeListener(server)
    },
  }
}
