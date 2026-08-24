#!/usr/bin/env node
// apps/cli/src/index.ts — el shebang DEBE quedar como primera línea del archivo
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { ConfigSchema, type LaqiConfig } from '@laqi/schema'
import { runMigrate } from './migrate'
import type { Runtime } from './runtime'
import { startServer } from './serve'
import { watchMocks } from './watcher'

const CONFIG_FILE = 'laqi.config.json'

// NOTA para quien implemente esta tarea: la USAGE de abajo ya anuncia
// `laqi migrate`, pero el comando en sí (el import de `runMigrate` y su
// bloque `if (positionals[0] === 'migrate')`) los añade la Tarea 13, que crea
// `migrate.ts`. Hasta entonces `laqi migrate` cae en el "unknown command" de
// más abajo — es el comportamiento esperado de ESTA tarea, no un bug.
const USAGE = `
laqi — mock server for frontend development

  laqi                 serve the mocks in ./laqi/ or ./laqi.json
  laqi migrate         convert v1 mock files to the v2 format
  laqi --help          show this message

Options:
  --port <number>      port to listen on          (default 8000)
  --host <address>     address to bind            (default 127.0.0.1)
  --dir <path>         mocks folder               (default laqi)
  --file <path>        single mock file           (default laqi.json)
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

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      port: { type: 'string' },
      host: { type: 'string' },
      dir: { type: 'string' },
      file: { type: 'string' },
      'dry-run': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  })

  if (values.help) {
    console.log(USAGE)
    return
  }

  const root = process.cwd()
  const config = loadConfig(root, {
    port: values.port === undefined ? undefined : Number(values.port),
    host: values.host,
    dir: values.dir,
    file: values.file,
  })

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

  let handle: Awaited<ReturnType<typeof startServer>>
  try {
    handle = await startServer({ root, config })
  } catch (error) {
    if (error instanceof Error && (error as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      console.error(
        `✖ port ${config.port} is already in use — pick another with --port, or stop whatever else is using it`,
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
    console.error(`\n  ${failed} problem${failed === 1 ? '' : 's'} — the rest of the mock is still served.`)
  }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
