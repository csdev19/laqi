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
 * Resolves `file` inside `root` and refuses if the result escapes it.
 *
 * `join(root, file)` alone isn't enough: `join(root, '../x.json')` leaves
 * the project without complaint. Every writer goes through here, which is
 * the point where ADR-0006 requires the MCP server to be confined — an
 * agent with these tools writes project files and must never leave it.
 */
function resolveInside(
  root: string,
  file: string,
): { ok: true; path: string } | { ok: false; error: string } {
  const refuse = {
    ok: false as const,
    error: `refusing to write ${JSON.stringify(file)}: it resolves outside the project root`,
  }

  // realpath, not resolve: `resolve` is purely lexical and doesn't look at
  // the disk, so a symlink INSIDE the project pointing outward dodges it —
  // verified, it wrote outside the root without complaint. The root also
  // gets resolved because it itself can be a symlink (on macOS /tmp is).
  const base = realOrSelf(resolve(root))
  const target = resolve(base, file)

  // The file may not exist yet, and neither may its folder. We resolve the
  // deepest ancestor that DOES exist: that's the one that could be a symlink.
  let existing = dirname(target)
  while (!existsSync(existing) && dirname(existing) !== existing) {
    existing = dirname(existing)
  }

  const realExisting = realOrSelf(existing)
  if (realExisting !== base && !realExisting.startsWith(base + sep)) return refuse

  // The file itself may be a symlink even though its folder is inside.
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

/** Adapts the lock's outcome to the `WriteResult` this module exposes. */
function locked(fullPath: string, work: () => WriteResult): WriteResult {
  const outcome = withFileLock(fullPath, work)
  return outcome.ok ? outcome.value : { ok: false, error: outcome.error }
}

/**
 * The REAL file key that corresponds to this id.
 *
 * The loader normalizes (`"get  /users"` is the id `"GET /users"`), so
 * looking up the raw key used to fail: the endpoint got listed and served,
 * but editing or deleting it returned 404. Compares by normalized id and
 * returns the key exactly as written, so as not to reformat the user's file
 * without them asking for it.
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

  // Read, check, and write under the lock: between the read and the write
  // another process could be doing the same thing to the same file.
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
    // The file may not exist yet (first endpoint created from the panel).
    const read = existsSync(fullPath) ? readFileObject(fullPath) : { ok: true as const, value: {} }
    if (!read.ok) return read

    // Normalized: writing "GET /users" next to an existing "get  /users"
    // would leave two keys with the same id, and the route table would
    // reject both as a collision — killing the one that was already working.
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
 * Writes several endpoints to a file in a single pass: one read, one
 * validation per entry, one atomic write. Writing them one by one rereads
 * and rewrites the whole file each time, and fires the watcher once per
 * endpoint.
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
      // Normalized, same as createEndpointInFile: see findKey.
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
