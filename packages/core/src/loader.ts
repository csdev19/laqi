import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join, relative } from 'node:path'
import {
  EndpointSchema,
  formatEndpointId,
  parseEndpointKey,
  ScenariosSchema,
  type HttpMethod,
  type MockResponse,
  type Scenarios,
} from '@laqi/schema'
import { parseJsonWithPosition } from './json-position'

export type LoadError = {
  file: string
  line?: number
  col?: number
  message: string
  excerpt?: string
}

export type LoadedEndpoint = {
  id: string
  method: HttpMethod
  path: string
  description?: string
  default: string
  responses: Record<string, MockResponse>
  file: string
  line: number
}

export type LoadResult = {
  endpoints: LoadedEndpoint[]
  scenarios: Scenarios
  errors: LoadError[]
  source: 'dir' | 'file' | 'none'
}

export const SCENARIOS_FILENAME = 'scenarios.json'

export function loadMocks(options: { root: string; dir: string; file: string }): LoadResult {
  const { root, dir, file } = options
  const dirPath = join(root, dir)
  const filePath = join(root, file)

  if (existsSync(dirPath) && statSync(dirPath).isDirectory()) {
    return loadFromFiles(root, collectJsonFiles(dirPath), 'dir')
  }

  if (existsSync(filePath)) {
    return loadFromFiles(root, [filePath], 'file')
  }

  return { endpoints: [], scenarios: {}, errors: [], source: 'none' }
}

/** Recorre la carpeta saltando dotfiles y dotdirs, en orden alfabético estable. */
function collectJsonFiles(dirPath: string): string[] {
  const found: string[] = []

  for (const entry of readdirSync(dirPath, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    if (entry.name.startsWith('.')) continue
    const full = join(dirPath, entry.name)

    if (entry.isDirectory()) found.push(...collectJsonFiles(full))
    else if (entry.name.endsWith('.json')) found.push(full)
  }

  return found
}

function loadFromFiles(root: string, paths: string[], source: 'dir' | 'file'): LoadResult {
  const endpoints: LoadedEndpoint[] = []
  const errors: LoadError[] = []
  let scenarios: Scenarios = {}

  for (const path of paths) {
    const displayPath = relative(root, path)

    let raw: string
    try {
      raw = readFileSync(path, 'utf8')
    } catch (error) {
      errors.push({
        file: displayPath,
        message: `could not read file: ${error instanceof Error ? error.message : String(error)}`,
      })
      continue
    }

    const parsed = parseJsonWithPosition(raw)

    // Un error de parseo invalida el archivo entero: no hay nada que rescatar.
    if (!parsed.ok) {
      errors.push({
        file: displayPath,
        line: parsed.line,
        col: parsed.col,
        message: parsed.message,
        excerpt: parsed.excerpt,
      })
      continue
    }

    if (basename(path) === SCENARIOS_FILENAME) {
      const result = ScenariosSchema.safeParse(parsed.value)
      if (result.success) scenarios = { ...scenarios, ...result.data }
      else errors.push({ file: displayPath, message: formatZodMessage(result.error.issues) })
      continue
    }

    if (typeof parsed.value !== 'object' || parsed.value === null || Array.isArray(parsed.value)) {
      errors.push({
        file: displayPath,
        message: 'a mock file must be a JSON object of "METHOD /path" keys',
      })
      continue
    }

    // Validación por clave, para que un endpoint inválido no tumbe a sus vecinos.
    for (const [key, definition] of Object.entries(parsed.value as Record<string, unknown>)) {
      const line = findKeyLine(raw, key)
      const parsedKey = parseEndpointKey(key)

      if (!parsedKey.ok) {
        errors.push({ file: displayPath, line, message: parsedKey.error })
        continue
      }

      const validated = EndpointSchema.safeParse(definition)
      if (!validated.success) {
        errors.push({
          file: displayPath,
          line,
          message: `${key}: ${formatZodMessage(validated.error.issues)}`,
        })
        continue
      }

      endpoints.push({
        id: formatEndpointId(parsedKey.value.method, parsedKey.value.path),
        method: parsedKey.value.method,
        path: parsedKey.value.path,
        description: validated.data.description,
        default: validated.data.default,
        responses: validated.data.responses,
        file: displayPath,
        line,
      })
    }
  }

  return { endpoints, scenarios, errors, source }
}

function formatZodMessage(issues: readonly { path: PropertyKey[]; message: string }[]): string {
  return issues
    .map((issue) =>
      issue.path.length > 0 ? `${issue.path.join('.')}: ${issue.message}` : issue.message,
    )
    .join('; ')
}

/** Localiza la línea donde se declara una clave, para el mensaje de error. */
function findKeyLine(source: string, key: string): number {
  const index = source.indexOf(JSON.stringify(key))
  if (index < 0) return 1
  return source.slice(0, index).split('\n').length
}
