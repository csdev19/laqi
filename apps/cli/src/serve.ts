// apps/cli/src/serve.ts

import { serve, type ServerType } from '@hono/node-server'
import {
  EventBus,
  ModuleApprovals,
  Project,
  refreshRequestFor,
  SessionCounters,
  StateStore,
  type LaqiEvent,
} from '@laqi/core'
import {
  SchemaSnapshotSchema,
  type Diagnostic,
  type EndpointDefinition,
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
  /** The local port the tunnel points at, if --share is active. */
  publicPort?: number
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
  /**
   * Pending module approvals, for this process only. A restart forgets them,
   * which is right: nobody approved running a file in a session that no
   * longer exists.
   */
  const approvals = new ModuleApprovals(root, config)
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
  let publicApp: Hono | null = share ? buildPublicApp(share) : null

  function reload(): Runtime {
    runtime = buildRuntime(root, config)
    app = buildApp()
    if (share) publicApp = buildPublicApp(share)
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
        // Where a schema source may be read from. The panel says it beside
        // the field, so a path is not discovered to be wrong by being wrong.
        schemaSourceRoot: config.schemaSources.root,
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

        const { exportTypes, inferShape, printTypes, typeNameFor } = await import('@laqi/generate')
        try {
          // The stored schema when there is one, the live body otherwise —
          // and the panel is told which, because the two are not equally
          // trustworthy. A schema says what the response may contain; a body
          // is one sample, and inferring from it cannot see a literal union,
          // an absent optional or a fixed-length tuple.
          const snapshot = response.schema
          const printed = snapshot
            ? await exportTypes(snapshot, typesOptions.lang)
            : {
                ...(await printTypes(inferShape(response.body ?? null), {
                  typeName: typeNameFor(id),
                  lang: typesOptions.lang,
                })),
                diagnostics: [],
              }

          // Two different things, both worth seeing beside the types: what
          // the IMPORT approximated, which is stored, and what this TARGET
          // could not express, which depends on the language just picked.
          const diagnostics = [...(snapshot?.diagnostics ?? []), ...printed.diagnostics]
          return {
            ok: true,
            code: printed.code,
            language: printed.language,
            origin: snapshot ? ('schema' as const) : ('body' as const),
            typeName: snapshot ? snapshot.name : typeNameFor(id),
            ...(diagnostics.length > 0 ? { diagnostics } : {}),
          }
        } catch (error) {
          return {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
            code: 'invalid',
          }
        }
      },
      importSchema: async (input) => {
        // A project module is executed, so it does not come in through the
        // door every other source uses. It goes through prepare/confirm,
        // where a person sees the resolved path first — and routing it here
        // would be a one-call way to run a file nobody looked at.
        if ((input.source as { kind?: unknown } | null)?.kind === 'project-module') {
          return {
            ok: false,
            error:
              'importing a project module runs it, so it goes through /api/schema/module/prepare and /api/schema/module/confirm',
            code: 'invalid',
          }
        }

        const { importSchema } = await import('@laqi/generate')
        try {
          const { snapshot, candidates } = await importSchema(input.source as never, {
            allowLoss: input.allowLoss === true,
            paths: { root, sourceRoot: config.schemaSources.root },
          })
          return { ok: true, snapshot, candidates }
        } catch (cause) {
          return failedImport(cause)
        }
      },
      previewBody: async (input) => {
        const parsed = SchemaSnapshotSchema.safeParse(input.snapshot)
        if (!parsed.success) {
          return {
            ok: false,
            error: parsed.error.issues.map((i) => i.message).join('; '),
            code: 'invalid',
          }
        }

        const { previewBody } = await import('@laqi/generate')
        try {
          const preview = await previewBody(parsed.data, {
            seed: input.seed,
            arrayLength: input.arrayLength,
          })
          return {
            ok: true,
            body: preview.body,
            evidence: preview.evidence,
            diagnostics: [...preview.diagnostics],
          }
        } catch (cause) {
          return failedImport(cause)
        }
      },
      regenerateResponse: async (id, responseName, options) => {
        const found = project.getResponse(id, responseName)
        if (!found.ok) return { ok: false, error: found.error, code: found.code }

        // Same refusal as the `from:` branch above, for the same reason:
        // inferring a shape back from one sample cannot see a literal union,
        // an absent optional or a fixed-length tuple.
        const snapshot = found.value.schema
        if (!snapshot) {
          return {
            ok: false,
            error:
              `${id} has no schema for ${JSON.stringify(responseName ?? 'its default response')}, ` +
              'so there is nothing to regenerate from — create it from a model or a JSON Schema first',
            code: 'invalid',
          }
        }

        // Read BEFORE generating: the revision names the response this
        // preview was decided about, and the caller hands it back to apply.
        const revision = project.getResponseRevision(id, responseName)
        if (!revision.ok) return { ok: false, error: revision.error, code: revision.code }

        const { previewBody } = await import('@laqi/generate')
        try {
          const preview = await previewBody(snapshot, options)
          return {
            ok: true,
            body: preview.body,
            evidence: preview.evidence,
            diagnostics: [...preview.diagnostics],
            revision: revision.value,
          }
        } catch (cause) {
          return failedImport(cause)
        }
      },
      applyGeneratedBody: (id, responseName, input) => {
        const result = project.applyGeneratedBody({
          id,
          response: responseName,
          body: input.body,
          generation: input.evidence,
          revision: input.revision,
          confirm: input.confirm,
        })
        if (!result.ok) {
          return {
            ok: false,
            error: result.error,
            code: result.code,
            ...(result.conflict === undefined ? {} : { conflict: result.conflict }),
          }
        }

        counters.recordWrite(result.value.file)
        reload()
        return { ok: true, revision: result.value.revision }
      },
      prepareModule: (input) => {
        const prepared = approvals.prepare(input)
        return prepared.ok
          ? {
              ok: true,
              token: prepared.value.token,
              resolvedPath: prepared.value.resolvedPath,
              exportName: prepared.value.exportName,
              side: prepared.value.side,
            }
          : { ok: false, error: prepared.error, code: prepared.code }
      },
      confirmModule: async (input) => {
        const redeemed = approvals.confirm(input.token)
        if (!redeemed.ok) return { ok: false, error: redeemed.error, code: redeemed.code }

        const { importSchema } = await import('@laqi/generate')
        try {
          const { snapshot, candidates } = await importSchema(
            {
              kind: 'project-module',
              file: redeemed.value.file,
              exportName: redeemed.value.exportName,
              side: redeemed.value.side,
            },
            {
              allowLoss: input.allowLoss === true,
              paths: { root, sourceRoot: config.schemaSources.root },
            },
          )
          return { ok: true, snapshot, candidates }
        } catch (cause) {
          return failedImport(cause)
        }
      },
      exportSchema: async (input) => {
        const parsed = SchemaSnapshotSchema.safeParse(input.snapshot)
        if (!parsed.success) {
          return {
            ok: false,
            error: parsed.error.issues.map((i) => i.message).join('; '),
            code: 'invalid',
          }
        }

        const { exportTypes } = await import('@laqi/generate')
        try {
          const exported = await exportTypes(parsed.data, input.target)
          return {
            ok: true,
            code: exported.code,
            language: exported.language,
            diagnostics: [...parsed.data.diagnostics, ...exported.diagnostics],
          }
        } catch (cause) {
          return failedImport(cause)
        }
      },
      getCapabilities: async () => {
        const { capabilities } = await import('@laqi/generate')
        return capabilities()
      },
      getResponseRevision: (id, responseName) => {
        const result = project.getResponseRevision(id, responseName)
        return result.ok
          ? { ok: true, revision: result.value }
          : { ok: false, error: result.error, code: result.code }
      },
      setResponseSchema: (id, responseName, input) => {
        const parsed = SchemaSnapshotSchema.safeParse(input.snapshot)
        if (!parsed.success) {
          return {
            ok: false,
            error: parsed.error.issues.map((i) => i.message).join('; '),
            code: 'invalid',
          }
        }

        const result = project.refreshSchema({
          id,
          response: responseName,
          schema: parsed.data,
          revision: input.revision,
        })
        if (!result.ok) {
          return {
            ok: false,
            error: result.error,
            code: result.code,
            ...(result.conflict === undefined ? {} : { conflict: result.conflict }),
          }
        }

        counters.recordWrite(result.value.file)
        reload()
        return { ok: true, revision: result.value.revision }
      },
      refreshResponseSchema: async (id, responseName, input) => {
        const found = project.getResponse(id, responseName)
        if (!found.ok) return { ok: false, error: found.error, code: found.code }

        const request = refreshRequestFor({
          snapshot: found.value.schema,
          root,
          sourceRoot: config.schemaSources.root,
        })
        if (!request.ok) return { ok: false, error: request.error, code: 'invalid' }

        const { importSchema } = await import('@laqi/generate')
        let snapshot
        try {
          snapshot = (await importSchema(request.value, { allowLoss: input.allowLoss === true }))
            .snapshot
        } catch (cause) {
          return failedImport(cause)
        }

        const result = project.refreshSchema({
          id,
          response: responseName,
          schema: snapshot,
          revision: input.revision,
        })
        if (!result.ok) {
          return {
            ok: false,
            error: result.error,
            code: result.code,
            ...(result.conflict === undefined ? {} : { conflict: result.conflict }),
          }
        }

        counters.recordWrite(result.value.file)
        reload()
        return { ok: true, snapshot, revision: result.value.revision }
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

  if (share) {
    try {
      publicServer = await new Promise<ServerType>((resolve, reject) => {
        const instance = serve(
          {
            fetch: (request: Request) => publicApp!.fetch(request),
            port: share.port,
            // Loopback too: cloudflared runs on this machine and connects
            // locally. Binding to 0.0.0.0 would expose the public surface
            // to the LAN as well as the tunnel, without anyone having asked for it.
            hostname: '127.0.0.1',
          },
          () => resolve(instance),
        )
        instance.on('error', reject)
      })
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
                // http.Server#close stops accepting new connections but
                // waits for the open ones to finish — and the
                // /__laqi/events stream never ends on its own: it lives
                // until the client cuts it off. With the panel open in
                // the browser, close() never resolved. Cutting the live
                // connections is what makes it terminate.
                // @hono/node-server's type is a union with Http2Server,
                // which doesn't declare it. In practice it's always an http.Server.
                ;(instance as { closeAllConnections?: () => void }).closeAllConnections?.()
              }),
          ),
      )
    },
  }
}

/**
 * An import that threw, turned into a refusal the caller can act on.
 *
 * The diagnostics ride along on purpose: a caller deciding whether to
 * acknowledge an approximation needs to see what would be approximated, and
 * asking it to make a second call to find out is how a strict default turns
 * into a habit of passing `allowLoss` blindly.
 */
function failedImport(cause: unknown): {
  ok: false
  error: string
  code: 'invalid'
  diagnostics?: Diagnostic[]
} {
  const diagnostics = (cause as { diagnostics?: Diagnostic[] }).diagnostics
  return {
    ok: false,
    error: cause instanceof Error ? cause.message : String(cause),
    code: 'invalid',
    ...(diagnostics === undefined ? {} : { diagnostics }),
  }
}
