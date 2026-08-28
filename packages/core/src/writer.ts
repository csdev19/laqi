import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'
import { withFileLock, writeFileAtomic } from './atomic-file'
import {
  EndpointSchema,
  formatEndpointId,
  parseEndpointKey,
  type EndpointDefinition,
} from '@laqi/schema'

export type WriteResult = { ok: true } | { ok: false; error: string }

/**
 * Resuelve `file` dentro de `root` y se niega si el resultado se sale.
 *
 * `join(root, file)` solo no alcanza: `join(root, '../x.json')` sale del
 * proyecto sin quejarse. Todo escritor pasa por acá, que es el punto donde
 * el ADR-0006 pide acotar al servidor MCP — un agente con estas
 * herramientas escribe archivos del proyecto y nunca debe salir de él.
 */
function resolveInside(
  root: string,
  file: string,
): { ok: true; path: string } | { ok: false; error: string } {
  const refuse = {
    ok: false as const,
    error: `refusing to write ${JSON.stringify(file)}: it resolves outside the project root`,
  }

  // realpath, no resolve: `resolve` es puramente léxico y no mira el disco,
  // así que un symlink DENTRO del proyecto apuntando afuera lo esquiva —
  // verificado, escribía fuera de la raíz sin quejarse. El root también se
  // resuelve porque él mismo puede ser un symlink (en macOS /tmp lo es).
  const base = realOrSelf(resolve(root))
  const target = resolve(base, file)

  // El archivo puede no existir todavía, y su carpeta tampoco. Se resuelve
  // el ancestro más profundo que SÍ existe: es el que puede ser un symlink.
  let existing = dirname(target)
  while (!existsSync(existing) && dirname(existing) !== existing) {
    existing = dirname(existing)
  }

  const realExisting = realOrSelf(existing)
  if (realExisting !== base && !realExisting.startsWith(base + sep)) return refuse

  // El archivo mismo puede ser un symlink aunque su carpeta esté adentro.
  const realTarget = existsSync(target) ? realOrSelf(target) : target
  if (realTarget !== base && !realTarget.startsWith(base + sep)) return refuse

  return { ok: true, path: target }
}

function realOrSelf(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

function readFileObject(
  fullPath: string,
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  if (!existsSync(fullPath)) return { ok: false, error: `file not found: ${fullPath}` }

  try {
    const parsed: unknown = JSON.parse(readFileSync(fullPath, 'utf8'))
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { ok: false, error: `not a JSON object: ${fullPath}` }
    }
    return { ok: true, value: parsed as Record<string, unknown> }
  } catch (error) {
    return {
      ok: false,
      error: `invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

function writeFileObject(fullPath: string, contents: Record<string, unknown>): void {
  writeFileAtomic(fullPath, `${JSON.stringify(contents, null, 2)}\n`)
}

/** Adapta el resultado del lock al `WriteResult` que expone este módulo. */
function locked(fullPath: string, work: () => WriteResult): WriteResult {
  const outcome = withFileLock(fullPath, work)
  return outcome.ok ? outcome.value : { ok: false, error: outcome.error }
}

/**
 * La clave REAL del archivo que corresponde a este id.
 *
 * El loader normaliza (`"get  /users"` es el id `"GET /users"`), así que
 * buscar la clave cruda fallaba: el endpoint se listaba y se servía, pero
 * editarlo o borrarlo devolvía 404. Se compara por id normalizado y se
 * devuelve la clave tal como está escrita, para no reformatear el archivo
 * del usuario sin que lo haya pedido.
 */
function findKey(contents: Record<string, unknown>, id: string): string | undefined {
  if (Object.hasOwn(contents, id)) return id

  for (const key of Object.keys(contents)) {
    const parsed = parseEndpointKey(key)
    if (parsed.ok && formatEndpointId(parsed.value.method, parsed.value.path) === id) return key
  }

  return undefined
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

  // Leer, comprobar y escribir bajo el lock: entre el read y el write puede
  // haber otro proceso haciendo lo mismo sobre el mismo archivo.
  return locked(fullPath, () => {
    const read = readFileObject(fullPath)
    if (!read.ok) return read

    const key = findKey(read.value, id)
    if (key === undefined) {
      return { ok: false, error: `no endpoint ${JSON.stringify(id)} in ${file}` }
    }

    read.value[key] = validated.data
    writeFileObject(fullPath, read.value)
    return { ok: true }
  })
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

  return locked(fullPath, () => {
    // El archivo puede no existir todavía (primer endpoint creado desde el panel).
    const read = existsSync(fullPath) ? readFileObject(fullPath) : { ok: true as const, value: {} }
    if (!read.ok) return read

    // Normalizado: escribir "GET /users" junto a un "get  /users" existente
    // dejaría dos claves con el mismo id, y la tabla de rutas rechazaría las
    // dos como colisión — matando la que ya andaba.
    const clash = findKey(read.value, id)
    if (clash !== undefined) {
      return { ok: false, error: `${JSON.stringify(id)} already exists in ${file}` }
    }

    read.value[id] = validated.data
    writeFileObject(fullPath, read.value)
    return { ok: true }
  })
}

/**
 * Escribe varios endpoints en un archivo de una sola pasada: una lectura,
 * una validación por entrada, una escritura atómica. Escribirlos uno por uno
 * relee y reescribe el archivo entero cada vez, y dispara el watcher una vez
 * por endpoint.
 */
export function createEndpointsInFile(params: {
  root: string
  file: string
  entries: { id: string; definition: EndpointDefinition }[]
}): WriteResult {
  const { root, file, entries } = params
  const inside = resolveInside(root, file)
  if (!inside.ok) return inside
  const fullPath = inside.path

  const validated: { id: string; definition: EndpointDefinition }[] = []
  for (const entry of entries) {
    const parsed = EndpointSchema.safeParse(entry.definition)
    if (!parsed.success) {
      return {
        ok: false,
        error: `${entry.id}: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
      }
    }
    validated.push({ id: entry.id, definition: parsed.data })
  }

  return locked(fullPath, () => {
    const read = existsSync(fullPath) ? readFileObject(fullPath) : { ok: true as const, value: {} }
    if (!read.ok) return read

    for (const entry of validated) {
      // Normalizado, igual que createEndpointInFile: ver findKey.
      if (findKey(read.value, entry.id) !== undefined) {
        return { ok: false, error: `${JSON.stringify(entry.id)} already exists in ${file}` }
      }
      read.value[entry.id] = entry.definition
    }

    writeFileObject(fullPath, read.value)
    return { ok: true }
  })
}

export function deleteEndpointFromFile(params: {
  root: string
  file: string
  id: string
}): WriteResult {
  const { root, file, id } = params
  const inside = resolveInside(root, file)
  if (!inside.ok) return inside
  const fullPath = inside.path

  return locked(fullPath, () => {
    const read = readFileObject(fullPath)
    if (!read.ok) return read

    const key = findKey(read.value, id)
    if (key === undefined) {
      return { ok: false, error: `no endpoint ${JSON.stringify(id)} in ${file}` }
    }

    delete read.value[key]
    writeFileObject(fullPath, read.value)
    return { ok: true }
  })
}
