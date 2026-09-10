import { readFileSync } from 'node:fs'
import { resolveSourcePath } from './writer'
import type { SchemaSnapshot, SourceRequest } from '@laqi/schema'

/**
 * Rebuilds the request that produced a stored snapshot, so its source can be
 * read again.
 *
 * Lives here, not in either transport, because the panel and MCP must reach
 * the same answer: if one of them could refresh from a path the other
 * refuses, the read boundary would only apply to whoever asked politely.
 *
 * A paste has no source to re-read — the text was never kept, by design —
 * and saying so is the honest answer. The panel offers re-import instead of
 * pretending a refresh happened.
 */
export function refreshRequestFor(params: {
  snapshot: SchemaSnapshot | undefined
  root: string
  sourceRoot: string
}): { ok: true; value: SourceRequest } | { ok: false; error: string } {
  const { snapshot, root, sourceRoot } = params
  if (!snapshot) {
    return { ok: false, error: 'this response has no schema, so there is nothing to refresh' }
  }

  const source = snapshot.source
  if (source.kind === 'typescript-paste') {
    return {
      ok: false,
      error:
        'this schema came from pasted TypeScript, which laqi does not keep — paste it again to update the schema',
    }
  }

  // Checked BEFORE the read: a project module is TypeScript, and parsing it
  // as JSON would fail first with a message about column 1 rather than about
  // the adapter that is missing.
  if (source.kind !== 'json-schema') {
    return {
      ok: false,
      error: `laqi cannot yet refresh a schema imported from ${JSON.stringify(source.kind)}`,
    }
  }

  if (source.file === undefined) {
    return {
      ok: false,
      error: 'this schema was imported without a file, so there is no source to re-read',
    }
  }

  const resolved = resolveSourcePath({ root, sourceRoot, file: source.file })
  if (!resolved.ok) return resolved

  let document: unknown
  try {
    document = JSON.parse(readFileSync(resolved.path, 'utf8'))
  } catch (cause) {
    return {
      ok: false,
      error: `could not read ${source.file}: ${cause instanceof Error ? cause.message : String(cause)}`,
    }
  }

  return {
    ok: true,
    value: { kind: 'json-schema', document, name: snapshot.name, file: source.file },
  }
}
