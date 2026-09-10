import {
  DIALECT_2020_12,
  diagnostic,
  isAcknowledgeable,
  KNOWN_SOURCE_KINDS,
  type Diagnostic,
  type GenerationEvidence,
  type SchemaSnapshot,
  type SourceDescriptor,
  type SourceRequest,
} from '@laqi/schema'
import { Cause, Data, Effect, Exit, Option } from 'effect'
import { bodyHash } from '@laqi/core/canonical-json'
import { compileSchema } from './compile-schema'
import { GenerateError } from './errors'
import { shapeToJsonSchema } from './json-schema'
import { normalizeDialect } from './normalize-dialect'
import { parseTypesEffect } from './parse-types'
import { generateFromPlanEffect, type GenerateOptions } from './plan'
import { TypeScriptCompiler } from './services/compiler'
import { FakerFactory } from './services/faker'
import { generateRuntime } from './services/runtime'

/**
 * An import that produced no snapshot. Its diagnostics travel on the error,
 * so a transport can show what went wrong without asking again.
 */
export type { SourceRequest } from '@laqi/schema'

export class ImportError extends Data.TaggedError('ImportError')<{
  readonly message: string
  readonly diagnostics: readonly Diagnostic[]
}> {}

export type ImportOptions = {
  /**
   * Acknowledge the approximations the diagnostics name. Only the losses the
   * table marks acknowledgeable may be waived; an error-severity diagnostic
   * never can.
   */
  allowLoss?: boolean
}

export type BodyPreview = {
  body: unknown
  evidence: GenerationEvidence
  /** The snapshot's own diagnostics, replayed so an approximation stays visible. */
  diagnostics: readonly Diagnostic[]
}

/**
 * Strict is the default. An import whose diagnostics contain any loss is not
 * saved and not used to generate — the caller sees what would have been
 * approximated and decides, rather than discovering it later in a body that
 * quietly says less than the source did.
 */
function applyLossPolicy(
  diagnostics: readonly Diagnostic[],
  options: ImportOptions,
): Diagnostic[] | ImportError {
  const blocking = diagnostics.filter(
    (item) => item.kind === 'loss' && !(options.allowLoss === true && isAcknowledgeable(item.code)),
  )
  if (blocking.length === 0) return [...diagnostics]

  const first = blocking[0]!
  const rest = blocking.length > 1 ? ` (and ${blocking.length - 1} more)` : ''
  return new ImportError({
    message:
      first.severity === 'error'
        ? `${first.message}${rest}`
        : `this import would lose information: ${first.message}${rest}`,
    diagnostics,
  })
}

/** Source → snapshot. The one entry point every transport uses. */
export const importSchemaEffect = (
  request: SourceRequest,
  options: ImportOptions = {},
): Effect.Effect<ImportResult, ImportError, TypeScriptCompiler> =>
  Effect.gen(function* () {
    const draft = yield* dispatch(request)

    const settled = applyLossPolicy(draft.diagnostics, options)
    if (settled instanceof ImportError) return yield* Effect.fail(settled)

    return {
      snapshot: {
        name: draft.name,
        document: draft.document,
        source: draft.source,
        diagnostics: settled,
      },
      candidates: draft.candidates ?? [draft.name],
    }
  })

/**
 * What an import produced, and what else it could have.
 *
 * `candidates` is about the REQUEST, not about the stored schema: a pasted
 * file declaring three interfaces has one snapshot and three candidates, and
 * a caller that never named one needs to be told which was picked. It is not
 * on the snapshot because a snapshot describes a document, and which
 * declarations sat beside it in a paste is not part of that document.
 */
export type ImportResult = {
  snapshot: SchemaSnapshot
  candidates: string[]
}

type Draft = {
  name: string
  document: Record<string, unknown>
  source: SourceDescriptor
  diagnostics: Diagnostic[]
  /** Present when the source offered a choice of declaration. */
  candidates?: string[]
}

/**
 * The composition root: the one place that knows which adapter serves which
 * kind. Exhaustive on purpose — a kind nobody serves is named as such, with
 * the kinds that do exist, rather than falling through to whichever branch
 * happens to be last and failing later with a confusing message about a
 * document that was never there.
 */
const dispatch = (
  request: SourceRequest,
): Effect.Effect<Draft, ImportError, TypeScriptCompiler> => {
  switch (request.kind) {
    case 'typescript-paste':
      return fromTypeScript(request)
    case 'json-schema':
      return fromJsonSchema(request)
    default:
      return Effect.fail(unknownAdapter(request))
  }
}

function unknownAdapter(request: never): ImportError {
  const kind = (request as { kind?: unknown }).kind
  const message = `no adapter serves the source kind ${JSON.stringify(kind)}. Known kinds: ${KNOWN_SOURCE_KINDS.join(', ')}`
  return new ImportError({
    message,
    diagnostics: [diagnostic('adapter.unknown', message)],
  })
}

/**
 * A pasted TypeScript model. The emitted document closes its objects,
 * because that is what an interface means — the source's intent, not
 * laqi's addition.
 */
const fromTypeScript = (request: SourceRequest & { kind: 'typescript-paste' }) =>
  Effect.gen(function* () {
    const parsed = yield* Effect.mapError(
      parseTypesEffect(request.source, request.typeName),
      (cause) => new ImportError({ message: cause.message, diagnostics: [] }),
    )

    return {
      name: parsed.typeName,
      document: { $schema: DIALECT_2020_12, ...shapeToJsonSchema(parsed.shape) },
      source: { kind: 'typescript-paste' } as const,
      diagnostics: parsed.diagnostics,
      candidates: parsed.candidates,
    } satisfies Draft
  })

/**
 * A JSON Schema document. It is stored exactly as it arrives, after dialect
 * normalization: laqi never adds `additionalProperties: false` and never
 * removes one the source supplied. Compiling is a support check, and its
 * plan is thrown away — generation compiles again from the stored document.
 */
const fromJsonSchema = (request: SourceRequest & { kind: 'json-schema' }) =>
  Effect.gen(function* () {
    const normalized = normalizeDialect(request.document)
    if (!normalized.ok) {
      return yield* Effect.fail(
        new ImportError({
          message: normalized.diagnostics[0]?.message ?? 'this document is not a JSON Schema',
          diagnostics: normalized.diagnostics,
        }),
      )
    }

    const compiled = compileSchema(normalized.document)
    const diagnostics = [...normalized.diagnostics, ...compiled.diagnostics]
    if (!compiled.ok) {
      return yield* Effect.fail(
        new ImportError({
          message: compiled.diagnostics[0]?.message ?? 'laqi cannot generate from this document',
          diagnostics,
        }),
      )
    }

    return {
      name: request.name ?? nameFrom(request.file) ?? 'Schema',
      document: normalized.document,
      source: request.file
        ? ({ kind: 'json-schema', file: request.file } as const)
        : ({ kind: 'json-schema' } as const),
      diagnostics,
    } satisfies Draft
  })

/** A file name, minus its extensions, is a better label than "Schema". */
function nameFrom(file: string | undefined): string | undefined {
  if (!file) return undefined
  const base = file.split('/').pop()?.split('.')[0]
  return base && base.length > 0 ? base : undefined
}

/**
 * Snapshot → body, with the evidence that reproduces it.
 *
 * A body laqi generated always has a seed: when the caller gives none, one
 * is allocated and recorded, so "generate again exactly" is always
 * answerable.
 */
export const previewBodyEffect = (
  snapshot: SchemaSnapshot,
  options: GenerateOptions = {},
): Effect.Effect<BodyPreview, GenerateError, FakerFactory> =>
  Effect.gen(function* () {
    const compiled = compileSchema(snapshot.document)
    if (!compiled.ok) {
      return yield* Effect.fail(
        new GenerateError({
          message:
            compiled.diagnostics[0]?.message ?? 'this stored document can no longer be compiled',
        }),
      )
    }

    const seed = options.seed ?? allocateSeed()
    const body = yield* generateFromPlanEffect(compiled.plan, { ...options, seed })

    return {
      body,
      evidence: {
        seed,
        options: { arrayLength: effectiveArrayLength(options.arrayLength) },
        bodyHash: bodyHash(body),
      },
      diagnostics: snapshot.diagnostics,
    }
  })

/**
 * The array length the generator actually used. Recording the requested one
 * would make the evidence a record of what was asked for rather than of what
 * happened, and the two differ whenever the clamp bites.
 */
const DEFAULT_ARRAY_LENGTH = 3
function effectiveArrayLength(requested: number | undefined): number {
  return Number.isFinite(requested)
    ? Math.max(1, Math.min(requested as number, 1000))
    : DEFAULT_ARRAY_LENGTH
}

/** A seed the caller did not choose. Any integer will do; it only has to be recorded. */
const allocateSeed = (): number => Math.floor(Math.random() * 2 ** 31)

/**
 * Rejects with the domain error itself rather than with Effect's wrapper.
 * The whole point of `ImportError` carrying its diagnostics is that a caller
 * reads them off the rejection; a wrapper would hide them one level down.
 */
async function reject<A, E>(effect: Effect.Effect<A, E, never>): Promise<A> {
  const exit = await generateRuntime().runPromiseExit(effect)
  if (Exit.isSuccess(exit)) return exit.value
  const failure = Cause.failureOption(exit.cause)
  throw Option.isSome(failure) ? failure.value : new Error(Cause.pretty(exit.cause))
}

export async function importSchema(
  request: SourceRequest,
  options: ImportOptions = {},
): Promise<ImportResult> {
  return reject(
    importSchemaEffect(request, options) as Effect.Effect<ImportResult, ImportError, never>,
  )
}

export async function previewBody(
  snapshot: SchemaSnapshot,
  options: GenerateOptions = {},
): Promise<BodyPreview> {
  return reject(
    previewBodyEffect(snapshot, options) as Effect.Effect<BodyPreview, GenerateError, never>,
  )
}
