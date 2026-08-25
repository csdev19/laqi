import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { EndpointSchema, type EndpointDefinition } from '@laqi/schema'

export type WriteResult = { ok: true } | { ok: false; error: string }

function readFileObject(fullPath: string): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  if (!existsSync(fullPath)) return { ok: false, error: `file not found: ${fullPath}` }

  try {
    const parsed: unknown = JSON.parse(readFileSync(fullPath, 'utf8'))
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { ok: false, error: `not a JSON object: ${fullPath}` }
    }
    return { ok: true, value: parsed as Record<string, unknown> }
  } catch (error) {
    return { ok: false, error: `invalid JSON: ${error instanceof Error ? error.message : String(error)}` }
  }
}

function writeFileObject(fullPath: string, contents: Record<string, unknown>): void {
  mkdirSync(dirname(fullPath), { recursive: true })
  writeFileSync(fullPath, `${JSON.stringify(contents, null, 2)}\n`, 'utf8')
}

export function updateEndpointInFile(params: {
  root: string
  file: string
  id: string
  definition: EndpointDefinition
}): WriteResult {
  const { root, file, id, definition } = params
  const fullPath = join(root, file)

  const validated = EndpointSchema.safeParse(definition)
  if (!validated.success) {
    return { ok: false, error: validated.error.issues.map((i) => i.message).join('; ') }
  }

  const read = readFileObject(fullPath)
  if (!read.ok) return read

  if (!Object.hasOwn(read.value, id)) {
    return { ok: false, error: `no endpoint ${JSON.stringify(id)} in ${file}` }
  }

  read.value[id] = validated.data
  writeFileObject(fullPath, read.value)
  return { ok: true }
}

export function createEndpointInFile(params: {
  root: string
  file: string
  id: string
  definition: EndpointDefinition
}): WriteResult {
  const { root, file, id, definition } = params
  const fullPath = join(root, file)

  const validated = EndpointSchema.safeParse(definition)
  if (!validated.success) {
    return { ok: false, error: validated.error.issues.map((i) => i.message).join('; ') }
  }

  // El archivo puede no existir todavía (primer endpoint creado desde el panel).
  const read = existsSync(fullPath) ? readFileObject(fullPath) : { ok: true as const, value: {} }
  if (!read.ok) return read

  if (Object.hasOwn(read.value, id)) {
    return { ok: false, error: `${JSON.stringify(id)} already exists in ${file}` }
  }

  read.value[id] = validated.data
  writeFileObject(fullPath, read.value)
  return { ok: true }
}

export function deleteEndpointFromFile(params: { root: string; file: string; id: string }): WriteResult {
  const { root, file, id } = params
  const fullPath = join(root, file)

  const read = readFileObject(fullPath)
  if (!read.ok) return read

  if (!Object.hasOwn(read.value, id)) {
    return { ok: false, error: `no endpoint ${JSON.stringify(id)} in ${file}` }
  }

  delete read.value[id]
  writeFileObject(fullPath, read.value)
  return { ok: true }
}
