import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'
import { EndpointSchema, type EndpointDefinition } from '@laqi/schema'

export type WriteResult = { ok: true } | { ok: false; error: string }

/**
 * Resuelve `file` dentro de `root` y se niega si el resultado se sale.
 *
 * `join(root, file)` solo no alcanza: `join(root, '../x.json')` sale del
 * proyecto sin quejarse. Todo escritor pasa por acá, que es el punto donde
 * el ADR-0006 pide acotar al servidor MCP — un agente con estas
 * herramientas escribe archivos del proyecto y nunca debe salir de él.
 */
function resolveInside(root: string, file: string): { ok: true; path: string } | { ok: false; error: string } {
  const base = resolve(root)
  const target = resolve(base, file)

  if (target !== base && !target.startsWith(base + sep)) {
    return { ok: false, error: `refusing to write ${JSON.stringify(file)}: it resolves outside the project root` }
  }

  return { ok: true, path: target }
}

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
  // Mismo patrón que state-store.ts: escribe a un temporal y renombra
  // encima — chokidar está mirando fullPath activamente, y un rename en el
  // mismo filesystem es atómico, así que un lector nunca ve un archivo a
  // medio escribir.
  const tmpPath = `${fullPath}.tmp`
  writeFileSync(tmpPath, `${JSON.stringify(contents, null, 2)}\n`, 'utf8')
  renameSync(tmpPath, fullPath)
}

export function updateEndpointInFile(params: {
  root: string
  file: string
  id: string
  definition: EndpointDefinition
}): WriteResult {
  const { root, file, id, definition } = params
  const inside = resolveInside(root, file)
  if (!inside.ok) return inside
  const fullPath = inside.path

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
  const inside = resolveInside(root, file)
  if (!inside.ok) return inside
  const fullPath = inside.path

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
  const inside = resolveInside(root, file)
  if (!inside.ok) return inside
  const fullPath = inside.path

  const read = readFileObject(fullPath)
  if (!read.ok) return read

  if (!Object.hasOwn(read.value, id)) {
    return { ok: false, error: `no endpoint ${JSON.stringify(id)} in ${file}` }
  }

  delete read.value[id]
  writeFileObject(fullPath, read.value)
  return { ok: true }
}
