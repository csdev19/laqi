import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { withFileLock, writeFileAtomic } from './atomic-file'
import { bodyHash } from './canonical-json'
import { formatJson } from './json-layout'
import { responseRevision } from './revision'
import {
  EndpointSchema,
  formatEndpointId,
  parseEndpointKey,
  type EndpointDefinition,
} from '@laqi/schema'

export type WriteResult = { ok: true } | { ok: false; error: string }

/**
 * Resolves `file` (relative to `root`) and refuses if it lands outside
 * every path in `bounds`.
 *
 * `bounds` is the MOCKS area, not the working directory. laqi reads the
 * mocks from `--dir`/`--file`, which may sit outside the directory it was
 * launched from — the repo's own `bun dev` runs
 * `--dir ../../examples/todo-app/laqi` — and comparing against the working
 * directory made laqi refuse to write the very files it was serving. The
 * mocks area is also the stricter boundary the ADR asks for: a project file
 * that is not a mock is now out of reach too.
 *
 * `join(root, file)` alone isn't enough: `join(root, '../x.json')` leaves
 * the area without complaint. Every writer goes through here, which is the
 * point where ADR-0006 requires the MCP server to be confined — an agent
 * with these tools writes project files and must never leave the mocks.
 */
function resolveInside(
  root: string,
  bounds: readonly string[],
  file: string,
): { ok: true; path: string } | { ok: false; error: string } {
  const target = resolve(root, file)
  const real = realish(target)
  const inside = bounds.some((bound) => {
    const base = realish(bound)
    return real === base || real.startsWith(base + sep)
  })

  return inside
    ? { ok: true, path: target }
    : {
        ok: false,
        error: `refusing to write ${JSON.stringify(file)}: it resolves outside the mocks directory`,
      }
}

/**
 * The path with every symlink in its EXISTING portion resolved.
 *
 * Plain `resolve` is lexical and never looks at the disk, so a symlink
 * inside the mocks pointing outward dodges it — verified, it wrote outside
 * the area without complaint. Plain `realpathSync` is no good either: it
 * throws on a path that does not exist yet, and neither the target file nor
 * the mocks directory has to exist (the first endpoint of a fresh project
 * creates both). So resolve the deepest ancestor that DOES exist — the only
 * part a symlink can hide in — and re-append the rest lexically.
 */
function realish(path: string): string {
  let existing = resolve(path)
  const rest: string[] = []

  while (!existsSync(existing)) {
    const parent = dirname(existing)
    // Reached the filesystem root without finding anything that exists.
    if (parent === existing) return existing
    rest.unshift(basename(existing))
    existing = parent
  }

  return rest.length > 0 ? join(realOrSelf(existing), ...rest) : realOrSelf(existing)
}

/** `realpathSync`, or the path itself when it cannot be resolved. */
function realOrSelf(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

/**
 * Resolves a SCHEMA SOURCE path and refuses if it lands outside the source
 * bounds.
 *
 * The source bounds are `schemaSources.root`, not the mocks area. A project's
 * types live in `src/types`, outside `laqi/`, and confining reads to the
 * mocks would make the ordinary case impossible. The reverse never holds:
 * being allowed to READ a path grants no write anywhere, because the writers
 * check their own bounds and never consult this one.
 *
 * Uses the same realpath-with-missing-tail algorithm as the writer, so a
 * symlink inside the source root pointing outward is refused too — the check
 * a lexical `resolve` silently passes.
 */
export function resolveSourcePath(params: {
  root: string
  sourceRoot: string
  file: string
}): { ok: true; path: string } | { ok: false; error: string } {
  const base = resolve(params.root, params.sourceRoot)
  const target = resolve(base, params.file)
  const real = realish(target)
  const realBase = realish(base)

  return real === realBase || real.startsWith(realBase + sep)
    ? { ok: true, path: target }
    : {
        ok: false,
        error: `refusing to read ${JSON.stringify(params.file)}: it resolves outside ${JSON.stringify(params.sourceRoot)}`,
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
  writeFileAtomic(fullPath, `${formatJson(contents)}\n`)
}

/** Adapts the lock's outcome to the result shape the caller expects. */
function locked<R extends { ok: boolean }>(
  fullPath: string,
  work: () => R,
): R | { ok: false; error: string } {
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
  bounds: readonly string[]
  file: string
  id: string
  definition: EndpointDefinition
}): WriteResult {
  const { root, bounds, file, id, definition } = params
  const inside = resolveInside(root, bounds, file)
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
  bounds: readonly string[]
  file: string
  id: string
  definition: EndpointDefinition
}): WriteResult {
  const { root, bounds, file, id, definition } = params
  const inside = resolveInside(root, bounds, file)
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
  bounds: readonly string[]
  file: string
  entries: { id: string; definition: EndpointDefinition }[]
}): WriteResult {
  const { root, bounds, file, entries } = params
  const inside = resolveInside(root, bounds, file)
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
  bounds: readonly string[]
  file: string
  id: string
}): WriteResult {
  const { root, bounds, file, id } = params
  const inside = resolveInside(root, bounds, file)
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

/**
 * Why a response write was refused. All three refuse identically; they are
 * told apart because the message a caller needs is different, and a panel
 * that says "this body was never generated" gets a better decision out of a
 * person than one that says "conflict".
 *
 * - `stale-revision`  someone else wrote this response since you read it
 * - `body-unverified` no generation evidence: an example, or hand-written
 * - `body-modified`   evidence exists but the body on disk is not what it describes
 */
export type ConflictReason = 'stale-revision' | 'body-unverified' | 'body-modified'

export type ResponseWriteResult =
  | { ok: true; revision: string }
  | { ok: false; error: string; conflict?: { reason: ConflictReason; revision: string } }

/**
 * What to change about one response. An absent key is left exactly as it is
 * on disk, byte for value — this is a patch on the stored entry, not a
 * rebuild of it, so nothing a caller did not mention can be lost.
 *
 * `generation: null` removes the evidence, which is what a body that laqi
 * no longer vouches for looks like.
 */
export type ResponsePatch = {
  body?: unknown
  generation?: unknown
  schema?: unknown
}

/** The raw stored entry for one response, or why it could not be reached. */
function findResponse(
  contents: Record<string, unknown>,
  id: string,
  response: string,
  file: string,
):
  | { ok: true; endpointKey: string; responses: Record<string, unknown> }
  | { ok: false; error: string } {
  const endpointKey = findKey(contents, id)
  if (endpointKey === undefined) {
    return { ok: false, error: `no endpoint ${JSON.stringify(id)} in ${file}` }
  }

  const endpoint = contents[endpointKey]
  if (typeof endpoint !== 'object' || endpoint === null || Array.isArray(endpoint)) {
    return { ok: false, error: `${JSON.stringify(id)} in ${file} is not an endpoint definition` }
  }

  const responses = (endpoint as Record<string, unknown>)['responses']
  if (typeof responses !== 'object' || responses === null || Array.isArray(responses)) {
    return { ok: false, error: `${JSON.stringify(id)} in ${file} declares no responses` }
  }

  const bag = responses as Record<string, unknown>
  if (!Object.hasOwn(bag, response)) {
    return {
      ok: false,
      error: `${JSON.stringify(response)} is not declared on ${id}. Available: ${Object.keys(bag).join(', ')}`,
    }
  }

  return { ok: true, endpointKey, responses: bag }
}

/**
 * The current revision of one response, read from the raw file.
 *
 * A caller reads this, decides, and hands it back to `updateResponseInFile`.
 * Taking it from the parsed endpoint instead would be a different number:
 * see `responseRevision`.
 */
export function readResponseRevision(params: {
  root: string
  bounds: readonly string[]
  file: string
  id: string
  response: string
}): { ok: true; revision: string } | { ok: false; error: string } {
  const { root, bounds, file, id, response } = params
  const inside = resolveInside(root, bounds, file)
  if (!inside.ok) return inside

  const read = readFileObject(inside.path)
  if (!read.ok) return read

  const found = findResponse(read.value, id, response, file)
  if (!found.ok) return found

  return { ok: true, revision: responseRevision(found.responses[response]) }
}

/**
 * Replaces parts of one response, under two checks that make a concurrent
 * write visible instead of silent.
 *
 * 1. The revision the caller observed must still be the revision on disk.
 *    Read, check and write all happen under the lock, so another process
 *    cannot slip in between them.
 * 2. When the patch replaces the `body`, the body being replaced must be one
 *    laqi wrote: its canonical hash must equal the stored
 *    `generation.bodyHash`. A hand-edited body, an OpenAPI example and a
 *    body whose bytes changed because the generator changed all fail this
 *    the same way, and all clear the same way — with `confirm`, which says
 *    the caller has seen what it is about to overwrite.
 *
 * A patch that does not touch the body skips check 2 entirely: refreshing a
 * schema is not a claim about the body, and asking someone to confirm a
 * write that keeps their body intact teaches them to confirm everything.
 *
 * `confirm` never waives check 1. A stale revision means the caller decided
 * about a different file than the one in front of it, and no amount of
 * confirming makes that decision current.
 */
export function updateResponseInFile(params: {
  root: string
  bounds: readonly string[]
  file: string
  id: string
  response: string
  revision: string
  confirm?: boolean
  patch: ResponsePatch
}): ResponseWriteResult {
  const { root, bounds, file, id, response, revision, confirm, patch } = params
  const inside = resolveInside(root, bounds, file)
  if (!inside.ok) return inside
  const fullPath = inside.path

  return locked(fullPath, () => {
    const read = readFileObject(fullPath)
    if (!read.ok) return read

    const found = findResponse(read.value, id, response, file)
    if (!found.ok) return found

    const stored = found.responses[response]
    const current = responseRevision(stored)
    if (current !== revision) {
      return {
        ok: false,
        error: `${JSON.stringify(response)} on ${id} changed since you read it — reread it and decide again`,
        conflict: { reason: 'stale-revision', revision: current },
      }
    }

    if (Object.hasOwn(patch, 'body') && confirm !== true) {
      const refusal = bodyIsVouchedFor(stored)
      if (refusal !== undefined) {
        return {
          ok: false,
          error: refusal.error,
          conflict: { reason: refusal.reason, revision: current },
        }
      }
    }

    const next: Record<string, unknown> = { ...(stored as Record<string, unknown>) }
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) continue
      // `null` removes the metadata keys, and is a value for the body.
      if (value === null && key !== 'body') delete next[key]
      else next[key] = value
    }
    found.responses[response] = next

    // Validated to REFUSE, not to rewrite: the endpoint written back is the
    // caller's own object with one response patched. Writing the parsed
    // result instead would strip every key the schema does not know about,
    // reformatting parts of a file nobody asked to touch.
    const validated = EndpointSchema.safeParse(read.value[found.endpointKey])
    if (!validated.success) {
      return { ok: false, error: validated.error.issues.map((i) => i.message).join('; ') }
    }

    writeFileObject(fullPath, read.value)
    return { ok: true, revision: responseRevision(next) }
  })
}

/** Undefined when laqi's evidence still describes the stored body. */
function bodyIsVouchedFor(stored: unknown): { reason: ConflictReason; error: string } | undefined {
  const entry = (stored ?? {}) as Record<string, unknown>
  const generation = entry['generation']
  const recorded =
    typeof generation === 'object' && generation !== null
      ? (generation as Record<string, unknown>)['bodyHash']
      : undefined

  if (typeof recorded !== 'string') {
    return {
      reason: 'body-unverified',
      error:
        'laqi did not write the body on disk, so it cannot tell a hand-written one from a stale one — look at what it holds, then confirm to replace it',
    }
  }

  if (recorded !== bodyHash(entry['body'])) {
    return {
      reason: 'body-modified',
      error:
        'the body on disk has changed since laqi wrote it — look at what you would lose, then confirm to replace it',
    }
  }

  return undefined
}
