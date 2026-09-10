import { diagnostic, type Diagnostic, type SchemaSnapshot } from '@laqi/schema'
import { Effect } from 'effect'
import { KNOWN_SOURCE_KINDS } from '@laqi/schema'
import { PrintError } from './errors'
import { printDocumentEffect, supportedLanguagesEffect } from './print-types'
import { generateRuntime } from './services/runtime'
import { Quicktype } from './services/quicktype'

export type Exported = {
  code: string
  language: string
  diagnostics: Diagnostic[]
}

/**
 * A stored schema → source code, with what the target could not express.
 *
 * Reads the document directly. Going through `Shape` on the way out would
 * drop whatever the document says beyond it, which is the whole reason the
 * document is what gets stored.
 *
 * The diagnostics are about the EXPORT, not about the schema: they say what
 * this particular target lost on the way to code. They are returned, never
 * stored — the snapshot's own diagnostics describe the import, and mixing
 * the two would make a re-export change a response's recorded history.
 */
export const exportTypesEffect = (
  snapshot: SchemaSnapshot,
  target?: string,
): Effect.Effect<Exported, PrintError, Quicktype> =>
  Effect.gen(function* () {
    const printed = yield* printDocumentEffect(snapshot.document, {
      typeName: snapshot.name,
      ...(target === undefined ? {} : { lang: target }),
    })

    return {
      code: printed.code,
      language: printed.language,
      diagnostics: exportDiagnostics(snapshot),
    }
  })

/**
 * What the exporter lost that the schema kept.
 *
 * Only tuples, for now, and for one reason: quicktype renders no fixed-arity,
 * per-position tuple type in any target it has, so `[string, number]` comes
 * out as an array of `string | number` — a type that accepts three strings.
 * Generation is unaffected; it runs from the compiled plan, which knows the
 * arity. Anyone copying the exported types has to be told the difference.
 */
export function exportDiagnostics(snapshot: SchemaSnapshot): Diagnostic[] {
  const pointer = firstTuple(snapshot.document, '')
  if (pointer === undefined) return []

  return [
    diagnostic(
      'export.tuple-approximated',
      'this target has no fixed-length tuple type, so the exported code accepts an array of any length; laqi still generates the exact arity',
      pointer,
    ),
  ]
}

/** The pointer to the first tuple in the document, if it holds one. */
function firstTuple(node: unknown, pointer: string): string | undefined {
  if (Array.isArray(node)) {
    for (const [index, item] of node.entries()) {
      const found = firstTuple(item, `${pointer}/${index}`)
      if (found !== undefined) return found
    }
    return undefined
  }
  if (typeof node !== 'object' || node === null) return undefined

  const entries = Object.entries(node as Record<string, unknown>)
  for (const [key, value] of entries) {
    if (key === 'prefixItems' && Array.isArray(value)) return `${pointer}/prefixItems`
    const found = firstTuple(value, `${pointer}/${escapePointer(key)}`)
    if (found !== undefined) return found
  }
  return undefined
}

/** RFC 6901: `~` is `~0` and `/` is `~1`, in that order. */
function escapePointer(segment: string): string {
  return segment.replaceAll('~', '~0').replaceAll('/', '~1')
}

export type Capabilities = {
  /** Source kinds `importSchema` serves. */
  inputs: string[]
  /** Code targets `exportTypes` serves. */
  exports: { targets: string[] }
}

/**
 * What this build can actually do, for a caller that has to choose.
 *
 * Derived from the code rather than written down beside it: a hand-kept list
 * is a list that goes stale, and the failure mode is a panel offering a
 * target that errors when picked.
 */
export const capabilitiesEffect: Effect.Effect<Capabilities, PrintError, Quicktype> = Effect.gen(
  function* () {
    const languages = yield* supportedLanguagesEffect
    return {
      inputs: [...KNOWN_SOURCE_KINDS],
      exports: { targets: languages.map((language) => language.name) },
    }
  },
)

export async function exportTypes(snapshot: SchemaSnapshot, target?: string): Promise<Exported> {
  return generateRuntime().runPromise(exportTypesEffect(snapshot, target))
}

export async function capabilities(): Promise<Capabilities> {
  return generateRuntime().runPromise(capabilitiesEffect)
}
