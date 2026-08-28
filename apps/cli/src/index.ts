#!/usr/bin/env node
// apps/cli/src/index.ts — el shebang DEBE quedar como primera línea del archivo
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { SessionCounters } from '@laqi/core'
import { ConfigSchema, type LaqiConfig } from '@laqi/schema'
import { generateToken } from '@laqi/server'
import { paint, renderFailure, row, startScreen, type Failure } from '@laqi/tui'
import { renderGoodbye } from './goodbye'
import { runMigrate } from './migrate'
import { laqiVersion, outputLevel } from './output'
import type { Runtime } from './runtime'
import { startServer, type ShareOptions } from './serve'
import { createCloudflaredProvider } from './tunnel'
import { watchMocks } from './watcher'

const CONFIG_FILE = 'laqi.config.json'

const USAGE = `
laqi — mock server for frontend development

  laqi                 serve the mocks in ./laqi/ or ./laqi.json
  laqi mcp             run the MCP server over stdio, for coding agents
  laqi migrate         convert v1 mock files to the v2 format
  laqi --help          show this message

Options:
  --port <number>      port to listen on          (default 8000)
  --host <address>     address to bind            (default 127.0.0.1)
  --dir <path>         mocks folder               (default laqi)
  --file <path>        single mock file           (default laqi.json)
  --share              open a public URL to the mocks (needs cloudflared)
  --public             with --share: no bearer token. Anyone with the URL
                       can read your mocks. Off by default, on purpose.
  --share-port <n>     local port the tunnel points at (default 8001)
  --dry-run            with migrate: print, do not write
`.trim()

function loadConfig(root: string, overrides: Partial<LaqiConfig>): LaqiConfig {
  const path = join(root, CONFIG_FILE)
  let fromFile: unknown = {}

  if (existsSync(path)) {
    try {
      fromFile = JSON.parse(readFileSync(path, 'utf8'))
    } catch (error) {
      reportFailure({
        severity: 'notice',
        headline: `${CONFIG_FILE} is not valid JSON`,
        cause: error instanceof Error ? error.message : String(error),
        outcome: 'using defaults · laqi starts anyway',
      })
    }
  }

  const merged = { ...(fromFile as Record<string, unknown>), ...stripUndefined(overrides) }
  const parsed = ConfigSchema.safeParse(merged)

  if (!parsed.success) {
    reportFailure({
      severity: 'notice',
      headline: `${CONFIG_FILE} is invalid`,
      cause: parsed.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; '),
      outcome: 'using defaults · laqi starts anyway',
    })
    return ConfigSchema.parse({})
  }

  return parsed.data
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>
}

/** `undefined` si no se pasó; `null` si es inválido (ya se reportó). */
function parsePort(raw: string | undefined, flag: string): number | undefined | null {
  if (raw === undefined) return undefined

  const port = Number(raw)
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    reportFatal({
      headline: `${flag} is not a valid port`,
      cause: `Expected a whole number between 0 and 65535, got ${JSON.stringify(raw)}.`,
      outcome: 'nothing was started · exit 5',
    })
    return null
  }
  return port
}

async function main(): Promise<void> {
  const startedAt = Date.now()
  const argsConfig = {
    allowPositionals: true,
    options: {
      port: { type: 'string' },
      host: { type: 'string' },
      dir: { type: 'string' },
      file: { type: 'string' },
      share: { type: 'boolean' },
      public: { type: 'boolean' },
      'share-port': { type: 'string' },
      'dry-run': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  } as const

  // parseArgs throws — a raw TypeError — on an unknown flag. Left uncaught,
  // that fell through to main().catch() below and read as `laqi crashed`
  // with Node's error text as the cause, exit 1. A bad flag is something the
  // user can fix from the message alone; it gets its own fatal report and
  // the exit code the spec assigns it, same as an unknown command below.
  let parsedArgs: ReturnType<typeof parseArgs<typeof argsConfig>>
  try {
    parsedArgs = parseArgs(argsConfig)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const flag = /'(--?[^']+)'/.exec(message)?.[1]
    reportFatal({
      headline: 'unrecognised flag or argument',
      cause: flag !== undefined ? `laqi does not recognise the ${flag} flag.` : message,
      remedy: ['laqi --help'],
      outcome: 'nothing was started · exit 5',
    })
    process.exitCode = 5
    return
  }
  const { values, positionals } = parsedArgs

  if (values.help) {
    console.log(USAGE)
    return
  }

  // Los flags numéricos se validan ANTES de mezclarlos con el archivo. Sin
  // esto, `--port abc` se volvía NaN, hacía fallar la validación del objeto
  // mezclado, y loadConfig descartaba el laqi.config.json ENTERO — culpando
  // al archivo, que estaba bien — y arrancaba con todos los defaults.
  const port = parsePort(values.port, '--port')
  if (port === null) {
    process.exitCode = 5
    return
  }

  const root = process.cwd()
  const config = loadConfig(root, {
    port,
    host: values.host,
    dir: values.dir,
    file: values.file,
  })

  if (positionals[0] === 'mcp') {
    // stdout es el canal del protocolo MCP: nada puede escribir ahí salvo
    // el transport. El banner de arranque va a stderr.
    const { startMcpStdio } = await import('@laqi/mcp')
    console.error(`laqi mcp — serving ${root}`)
    await startMcpStdio({ root, config })
    return
  }

  if (positionals[0] === 'migrate') {
    // runMigrate sets process.exitCode itself: which of the four exit codes
    // applies depends on which of its own failure branches ran, and only it
    // knows that.
    runMigrate({ root, config, dryRun: values['dry-run'] === true })
    return
  }

  if (positionals[0] !== undefined) {
    reportFatal({
      headline: `unknown command ${JSON.stringify(positionals[0])}`,
      cause: `laqi does not recognise ${JSON.stringify(positionals[0])} as a command.`,
      remedy: ['laqi --help'],
      outcome: 'nothing was started · exit 5',
    })
    process.exitCode = 5
    return
  }

  const wantsShare = values.share === true

  if (values.public === true && !wantsShare) {
    reportFatal({
      headline: '--public only means something with --share',
      cause: '--public drops the bearer token, and there is nothing to share without --share.',
      remedy: ['laqi --share --public'],
      outcome: 'nothing was started · exit 5',
    })
    process.exitCode = 5
    return
  }

  const provider = createCloudflaredProvider()
  let share: ShareOptions | undefined

  if (wantsShare) {
    // Un flag mal escrito se reporta antes que un problema del entorno: es
    // lo que el developer puede arreglar solo. --port pasa por ConfigSchema;
    // --share-port no tenía nada, así que un valor no numérico llegaba como
    // NaN hasta server.listen() y salía como un stack pelado.
    const parsedSharePort = parsePort(values['share-port'], '--share-port')
    if (parsedSharePort === null) {
      process.exitCode = 5
      return
    }
    const sharePort = parsedSharePort ?? config.port + 1

    // Se chequea ANTES de abrir puertos: fallar después de imprimir el
    // banner de arranque haría creer que algo quedó a medio levantar.
    const unavailable = await provider.unavailable()
    if (unavailable !== null) {
      reportFatal({
        headline: 'the tunnel could not start',
        cause: unavailable,
        outcome: 'nothing was started · exit 1',
      })
      process.exitCode = 1
      return
    }

    share = {
      port: sharePort,
      token: values.public === true ? null : generateToken(),
      // El ADR-0007 prohíbe `*` en modo compartido. Con la config por
      // defecto no hay ningún origen de navegador permitido — que es lo
      // seguro. curl y React Native no mandan Origin, así que siguen andando.
      origins: config.cors === '*' ? [] : config.cors,
    }
  }

  // Owned here, not inside startServer: it has to survive the server being
  // closed on the way out, so the goodbye summary can still read it.
  const counters = new SessionCounters()

  let handle: Awaited<ReturnType<typeof startServer>>
  try {
    handle = await startServer({ root, config, share, counters })
  } catch (error) {
    if (error instanceof Error && (error as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      // Con --share hay DOS listeners. Cuál falló lo marca startServer en el
      // propio error; leerlo del texto del mensaje se equivocaba en las dos
      // direcciones, y encima cambia entre Bun y Node.
      const failedListener = (error as { laqiListener?: 'share' }).laqiListener
      const busyPort = failedListener === 'share' && share !== undefined ? share.port : config.port
      reportFatal({
        headline: 'laqi could not start',
        cause: `Port ${busyPort} is already in use.`,
        remedy: [`laqi --port ${busyPort + 1}`, `kill $(lsof -ti :${busyPort})`],
        outcome: 'nothing was started · exit 3',
      })
      process.exitCode = 3
      return
    }
    throw error
  }
  const startupExit = report(handle.current(), handle.port, config, Date.now() - startedAt)
  if (startupExit !== undefined) {
    // Nothing loaded and nothing will, until someone edits a file — there is
    // no server worth leaving open. No watcher or signal handlers exist yet
    // at this point, so a plain close-and-return is enough.
    await handle.close().catch(() => {})
    process.exitCode = startupExit
    return
  }

  const watcher = watchMocks({
    root,
    dir: config.dir,
    file: config.file,
    onChange: () => {
      // Measured around the reload itself, not since process start: `bootMs`
      // is "how long did THIS load take", and reusing `startedAt` here made
      // a reload an hour in report `ready in 1h` — which reads as laqi having
      // gotten slow, not as the uptime it actually was.
      const reloadStartedAt = Date.now()
      const runtime = handle.reload()
      const reloadExit = report(runtime, handle.port, config, Date.now() - reloadStartedAt)
      if (reloadExit !== undefined) {
        // A save that empties the mocks folder, or breaks every file in it,
        // leaves the same "nothing to serve" state a fresh start would —
        // same fatal treatment and exit code, not a silent, empty server.
        void (async () => {
          await watcher.close().catch(() => {})
          if (tunnel) await tunnel.stop().catch(() => {})
          await handle.close().catch(() => {})
          process.exit(reloadExit)
        })()
      }
    },
  })

  // Set only once the tunnel has actually opened — never just because
  // --share was passed — so a failed tunnel (still serving locally, sharing
  // off; see the catch below) does not make the goodbye screen claim a
  // public URL closed that never opened.
  let tunnel: Awaited<ReturnType<typeof provider.start>> | undefined

  // `once`, not `on`: the first ^C or SIGTERM runs this and prints the
  // summary. A second one arrives with no listener left to catch it, so Node
  // falls back to its default disposition — immediate termination, no
  // summary — which is exactly what someone pressing ^C twice wants.
  const shutdown = () => {
    void (async () => {
      // Sin esto cloudflared sobrevive al CLI y el túnel queda abierto
      // apuntando a un puerto muerto.
      await watcher.close().catch(() => {})
      if (tunnel) await tunnel.stop().catch(() => {})
      await handle.close().catch(() => {})

      console.log(
        renderGoodbye(
          counters,
          Date.now() - startedAt,
          outputLevel(),
          tunnel !== undefined,
          process.stdout.columns,
        ),
      )
      process.exit(0)
    })()
  }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)

  if (share === undefined) return

  try {
    tunnel = await provider.start({ port: handle.publicPort ?? share.port })
  } catch (error) {
    reportFailure({
      severity: 'degraded',
      headline: 'the tunnel could not open',
      cause: error instanceof Error ? error.message : String(error),
      outcome: 'still serving locally · sharing is off',
    })
    return
  }

  handle.setShareUrl(tunnel.url)
  reportShare(tunnel.url, share, config)
}

function reportShare(url: string, share: ShareOptions, config: LaqiConfig): void {
  const level = outputLevel()

  console.log(
    [
      '',
      row('shared', paint(url, 'accent', level), level),
      row(
        '',
        paint(
          `mocks only — the panel and control plane stay on ${config.host}:${config.port}`,
          'dim',
          level,
        ),
        level,
      ),
    ].join('\n'),
  )

  if (share.token === null) {
    reportFailure({
      severity: 'notice',
      headline: 'sharing without a token (--public)',
      cause:
        'Anyone with this URL can read your mocks, and these URLs are actively scanned by bots.',
      outcome: 'sharing continues · drop --public to require a token',
    })
  } else {
    console.log(
      [
        '',
        row('token', paint(share.token, 'value', level), level),
        row(
          '',
          paint(`curl -H 'Authorization: Bearer ${share.token}' ${url}/`, 'dim', level),
          level,
        ),
      ].join('\n'),
    )
  }

  if (share.origins.length === 0) {
    console.log(
      [
        '',
        row(
          'cors',
          paint('no browser origin allowed (CORS is never "*" when shared)', 'dim', level),
          level,
        ),
        row(
          '',
          paint('declare them in laqi.config.json as "cors": ["https://your.app"]', 'dim', level),
          level,
        ),
      ].join('\n'),
    )
  } else {
    console.log(row('cors', paint(share.origins.join(', '), 'value', level), level))
  }

  console.log('')
}

/** `console.error(renderFailure(...))` without repeating `outputLevel()` at every call site. */
function reportFailure(failure: Failure): void {
  console.error(renderFailure(failure, outputLevel()))
}

function reportFatal(failure: Omit<Failure, 'severity'>): void {
  reportFailure({ severity: 'fatal', ...failure })
}

/**
 * Prints the start screen, or — when there is nothing to serve — a fatal
 * failure instead. Returns the exit code to stop with in the latter case,
 * `undefined` when laqi is actually serving something and should keep
 * running. Shared by both the initial boot and every reload, so a save that
 * empties the mocks folder gets the same verdict a fresh start would.
 */
function report(
  runtime: Runtime,
  port: number,
  config: LaqiConfig,
  bootMs: number,
): number | undefined {
  const level = outputLevel()
  const where = runtime.source === 'file' ? `./${config.file}` : `./${config.dir}/`
  const base = `http://${config.host}:${port}`
  const loaded = runtime.table.endpoints.length

  // Nothing loaded and nothing explains why: no mock folder, or one that
  // defines no endpoints. There is nothing to advertise a URL for.
  if (loaded === 0 && runtime.errors.length === 0) {
    reportFatal({
      headline: `${where} has nothing to serve`,
      cause: 'No mock folder was found, or it exists but defines no endpoints.',
      outcome: 'nothing is being served · exit 2',
    })
    return 2
  }

  // Nothing loaded, and every file that would have loaded failed to parse.
  // This is the total-failure case, not the partial one below it: an
  // address that answers 404 to everything is not "still serving".
  if (loaded === 0 && runtime.errors.length > 0) {
    for (const error of runtime.errors) {
      reportFailure({
        severity: 'fatal',
        headline: `${error.file} failed to load`,
        cause: error.message,
        evidence: { file: error.file, line: error.line, col: error.col, excerpt: error.excerpt },
        outcome: 'nothing is being served · exit 4',
      })
    }
    return 4
  }

  const responses = runtime.table.endpoints.reduce(
    (total, endpoint) => total + Object.keys(endpoint.responses).length,
    0,
  )

  console.log(
    startScreen(
      {
        version: laqiVersion(),
        servingUrl: base,
        panelUrl: `${base}/__laqi`,
        watching: where,
        endpoints: loaded,
        responses,
        scenarios: Object.keys(runtime.scenarios).length,
        bootMs,
      },
      level,
      process.stdout.columns,
    ),
  )

  // Some files parsed and some did not: degraded, not fatal — laqi keeps
  // serving the endpoints that did load.
  for (const error of runtime.errors) {
    reportFailure({
      severity: 'degraded',
      headline: `${error.file} failed to load`,
      cause: error.message,
      evidence: { file: error.file, line: error.line, col: error.col, excerpt: error.excerpt },
      outcome: `still serving the ${loaded} endpoint${loaded === 1 ? '' : 's'} that loaded · save the file to retry`,
    })
  }

  return undefined
}

main().catch((error: unknown) => {
  reportFatal({
    headline: 'laqi crashed',
    cause: error instanceof Error ? error.message : String(error),
    outcome: 'exit 1',
  })
  process.exitCode = 1
})
