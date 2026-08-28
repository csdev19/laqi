#!/usr/bin/env node
// apps/cli/src/index.ts — el shebang DEBE quedar como primera línea del archivo
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { ConfigSchema, type LaqiConfig } from '@laqi/schema'
import { generateToken } from '@laqi/server'
import { runMigrate } from './migrate'
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
      console.error(`✖ ${CONFIG_FILE} is not valid JSON — using defaults`)
      console.error(`  ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const merged = { ...(fromFile as Record<string, unknown>), ...stripUndefined(overrides) }
  const parsed = ConfigSchema.safeParse(merged)

  if (!parsed.success) {
    console.error(`✖ ${CONFIG_FILE} is invalid — using defaults`)
    for (const issue of parsed.error.issues) {
      console.error(`  ${issue.path.join('.')}: ${issue.message}`)
    }
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
    console.error(`✖ ${flag} must be a port number between 0 and 65535, got ${JSON.stringify(raw)}`)
    return null
  }
  return port
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
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
  })

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
    process.exitCode = 1
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
    const failed = runMigrate({ root, config, dryRun: values['dry-run'] === true })
    if (failed) process.exitCode = 1
    return
  }

  if (positionals[0] !== undefined) {
    console.error(`✖ unknown command ${JSON.stringify(positionals[0])}\n`)
    console.error(USAGE)
    process.exitCode = 1
    return
  }

  const wantsShare = values.share === true

  if (values.public === true && !wantsShare) {
    console.error('✖ --public only means something with --share\n')
    console.error(USAGE)
    process.exitCode = 1
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
      process.exitCode = 1
      return
    }
    const sharePort = parsedSharePort ?? config.port + 1

    // Se chequea ANTES de abrir puertos: fallar después de imprimir el
    // banner de arranque haría creer que algo quedó a medio levantar.
    const unavailable = await provider.unavailable()
    if (unavailable !== null) {
      console.error(`✖ ${unavailable}`)
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

  let handle: Awaited<ReturnType<typeof startServer>>
  try {
    handle = await startServer({ root, config, share })
  } catch (error) {
    if (error instanceof Error && (error as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      // Con --share hay DOS listeners. Cuál falló lo marca startServer en el
      // propio error; leerlo del texto del mensaje se equivocaba en las dos
      // direcciones, y encima cambia entre Bun y Node.
      const failed = (error as { laqiListener?: 'share' }).laqiListener
      console.error(
        failed === 'share' && share !== undefined
          ? `✖ port ${share.port} is already in use — pick another with --share-port, or stop whatever else is using it`
          : `✖ port ${config.port} is already in use — pick another with --port, or stop whatever else is using it`,
      )
      process.exitCode = 1
      return
    }
    throw error
  }
  report(handle.current(), handle.port, config)

  watchMocks({
    root,
    dir: config.dir,
    file: config.file,
    onChange: () => report(handle.reload(), handle.port, config),
  })

  if (share === undefined) return

  let tunnel: Awaited<ReturnType<typeof provider.start>>
  try {
    tunnel = await provider.start({ port: handle.publicPort ?? share.port })
  } catch (error) {
    console.error(
      `\n✖ could not open the tunnel: ${error instanceof Error ? error.message : String(error)}`,
    )
    console.error('  The local server is still running.')
    return
  }

  handle.setShareUrl(tunnel.url)
  reportShare(tunnel.url, share, config)

  // Sin esto cloudflared sobrevive al CLI y el túnel queda abierto apuntando
  // a un puerto muerto.
  const shutDown = () => {
    void tunnel.stop().finally(() => process.exit(0))
  }
  process.once('SIGINT', shutDown)
  process.once('SIGTERM', shutDown)
}

function reportShare(url: string, share: ShareOptions, config: LaqiConfig): void {
  console.log(`\n🌐 EXPOSED TO THE INTERNET  ${url}`)
  console.log(
    `   mocks only — the panel and the control plane stay on ${config.host}:${config.port}`,
  )

  if (share.token === null) {
    console.log('\n   ⚠ NO TOKEN (--public). Anyone with this URL can read your mocks.')
    console.log('     These URLs are actively scanned by bots. Drop --public to require a token.')
  } else {
    console.log(`\n   token  ${share.token}`)
    console.log(`   curl -H 'Authorization: Bearer ${share.token}' ${url}/`)
  }

  if (share.origins.length === 0) {
    console.log(
      '\n   No browser origin is allowed through the tunnel (CORS is never "*" when shared).',
    )
    console.log(
      '   Declare them in laqi.config.json as "cors": ["https://your.app"] if a browser needs it.',
    )
  } else {
    console.log(`\n   CORS allows: ${share.origins.join(', ')}`)
  }

  console.log('')
}

function report(runtime: Runtime, port: number, config: LaqiConfig): void {
  const count = runtime.table.endpoints.length
  const failed = runtime.errors.length

  console.log(`\n⚡ laqi  http://${config.host}:${port}`)
  const where = runtime.source === 'file' ? `./${config.file}` : `./${config.dir}/`
  console.log(`   watching ${where}  ·  ${count} endpoint${count === 1 ? '' : 's'}`)

  for (const error of runtime.errors) {
    console.error(
      `\n✖ LOAD FAILED  ${error.file}${error.line ? `:${error.line}${error.col ? `:${error.col}` : ''}` : ''}`,
    )
    console.error(`  ${error.message}`)
    if (error.excerpt) console.error(error.excerpt.replace(/^/gm, '  '))
  }

  if (failed > 0) {
    console.error(
      `\n  ${failed} problem${failed === 1 ? '' : 's'} — the rest of the mock is still served.`,
    )
  }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
