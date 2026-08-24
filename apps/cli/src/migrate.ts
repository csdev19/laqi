import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import {
  formatEndpointId,
  isHttpMethod,
  type EndpointDefinition,
  type LaqiConfig,
  type MockResponse,
} from '@laqi/schema'

export type MigrationResult = {
  output: Record<string, EndpointDefinition>
  warnings: string[]
}

/** El hack de v1 para meter varios métodos bajo la misma clave JSON. */
const METHOD_PREFIX = /^\((\w+)\)(.*)$/

type V1Response = { statusCode?: unknown; selectorCode?: unknown; body?: unknown }
type V1Endpoint = { method?: unknown; codeResponse?: unknown; responses?: unknown }

export function migrateV1(input: unknown): MigrationResult {
  const warnings: string[] = []
  const output: Record<string, EndpointDefinition> = {}

  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { output, warnings: ['input is not a v1 mock object — nothing to migrate'] }
  }

  for (const [key, raw] of Object.entries(input as Record<string, unknown>)) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      warnings.push(`skipped ${JSON.stringify(key)}: not an endpoint object`)
      continue
    }

    const endpoint = raw as V1Endpoint
    const prefixMatch = METHOD_PREFIX.exec(key)
    const rawMethod = prefixMatch ? prefixMatch[1] : endpoint.method
    const rawPath = prefixMatch ? prefixMatch[2] : key
    const method = String(rawMethod ?? 'GET').toUpperCase()

    if (!isHttpMethod(method)) {
      warnings.push(`skipped ${JSON.stringify(key)}: unknown method ${JSON.stringify(rawMethod)}`)
      continue
    }

    const path = String(rawPath ?? '').startsWith('/') ? String(rawPath) : `/${String(rawPath ?? '')}`
    const id = formatEndpointId(method, path)

    if (!Array.isArray(endpoint.responses) || endpoint.responses.length === 0) {
      warnings.push(`skipped ${JSON.stringify(key)}: no responses array`)
      continue
    }

    const responses: Record<string, MockResponse> = {}
    for (const item of endpoint.responses as V1Response[]) {
      const status = Number(item.statusCode ?? 200)
      const base = String(item.selectorCode ?? status)

      let name = base
      let suffix = 2
      while (Object.hasOwn(responses, name)) name = `${base}-${suffix++}`
      if (name !== base) {
        warnings.push(`${id}: duplicate selectorCode ${JSON.stringify(base)} renamed to ${JSON.stringify(name)}`)
      }

      responses[name] = Number.isFinite(status)
        ? { status, ...(item.body === undefined ? {} : { body: item.body }) }
        : { status: 200, ...(item.body === undefined ? {} : { body: item.body }) }
    }

    const names = Object.keys(responses)
    const requested = endpoint.codeResponse === undefined ? undefined : String(endpoint.codeResponse)
    let fallback = names[0] as string

    if (requested !== undefined && names.includes(requested)) {
      fallback = requested
    } else if (requested !== undefined) {
      warnings.push(
        `${id}: codeResponse ${JSON.stringify(requested)} matches no selectorCode — defaulting to ${JSON.stringify(fallback)}`,
      )
    }

    if (Object.hasOwn(output, id)) {
      warnings.push(`${id}: declared more than once — later definition dropped (see ADR-0008)`)
      continue
    }

    output[id] = { default: fallback, responses }
  }

  return { output, warnings }
}

/** Devuelve true si hubo algún fallo, para que el CLI ponga exit code 1. */
export function runMigrate(options: { root: string; config: LaqiConfig; dryRun: boolean }): boolean {
  const { root, config, dryRun } = options
  const sources = findV1Sources(root, config)

  if (sources.length === 0) {
    console.error('✖ nothing to migrate — no mock-data/ folder or mock.config.json found')
    return true
  }

  let merged: Record<string, EndpointDefinition> = {}
  const warnings: string[] = []

  for (const source of sources) {
    try {
      const result = migrateV1(JSON.parse(readFileSync(source, 'utf8')))
      merged = { ...merged, ...result.output }
      warnings.push(...result.warnings.map((w) => `${relative(root, source)}: ${w}`))
    } catch (error) {
      warnings.push(`${relative(root, source)}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const target = join(root, config.file)
  const contents = `${JSON.stringify(merged, null, 2)}\n`

  if (dryRun) {
    console.log(contents)
  } else if (existsSync(target)) {
    console.error(`✖ ${config.file} already exists — move it aside or run with --dry-run`)
    return true
  } else {
    writeFileSync(target, contents, 'utf8')
    console.log(`✔ wrote ${Object.keys(merged).length} endpoints to ${config.file}`)
  }

  for (const warning of warnings) console.warn(`  ! ${warning}`)

  return false
}

function findV1Sources(root: string, config: LaqiConfig): string[] {
  // v1 leía `path` de mock.config.json, con 'mock-data' por defecto.
  let dir = 'mock-data'
  const legacyConfig = join(root, 'mock.config.json')

  if (existsSync(legacyConfig)) {
    try {
      const parsed = JSON.parse(readFileSync(legacyConfig, 'utf8')) as { path?: unknown }
      if (typeof parsed.path === 'string') dir = parsed.path
    } catch {
      // Config ilegible: seguimos con el default de v1.
    }
  }

  const base = join(root, dir)
  if (!existsSync(base)) return []

  const found: string[] = []
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      if (entry.name.startsWith('.')) continue
      const full = join(current, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith('.json')) found.push(full)
    }
  }
  walk(base)

  return found
}
