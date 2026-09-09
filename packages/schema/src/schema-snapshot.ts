import { z } from 'zod'
import { DiagnosticSchema } from './diagnostics'

/** The one dialect laqi stores. Every adapter normalises to it before saving. */
export const DIALECT_2020_12 = 'https://json-schema.org/draft/2020-12/schema'

/**
 * A JSON Schema value. `true` and `false` are legal schemas and appear
 * nested — `items: false` closes a tuple — but a stored root document is
 * always an object, because the root is where the dialect is declared and a
 * boolean has nowhere to declare it. A root `true` normalises to `{}`.
 */
export type JsonSchema = boolean | { [keyword: string]: unknown }

/**
 * Where the document came from — never where the body came from. A refresh
 * reads this to find the source again, so it holds everything needed to do
 * that and nothing else.
 */
export const SourceDescriptorSchema = z.discriminatedUnion('kind', [
  // Strict throughout: a paste has no file, and laqi must not invent one.
  z.strictObject({ kind: z.literal('typescript-paste') }),
  z.strictObject({ kind: z.literal('json-schema'), file: z.string().min(1).optional() }),
  z.strictObject({
    kind: z.literal('openapi'),
    file: z.string().min(1).optional(),
    /** JSON Pointer to the response schema inside the document, so a refresh finds it again. */
    pointer: z.string(),
  }),
  z.strictObject({
    kind: z.literal('project-module'),
    file: z.string().min(1),
    exportName: z.string().min(1),
    /** Which Standard JSON Schema conversion was used. Responses default to output. */
    side: z.enum(['input', 'output']),
  }),
])

export type SourceDescriptor = z.infer<typeof SourceDescriptorSchema>

/**
 * The schema a response is associated with, as stored.
 *
 * The document is kept exactly as the adapter produced it: laqi never adds
 * `additionalProperties: false` to an imported document and never removes it
 * when the source supplied it. Nothing is stored beside the document — no
 * Shape, no packed form, no original TypeScript, no runtime object — which
 * is why this object is strict.
 */
export const SchemaSnapshotSchema = z.strictObject({
  /** A display label: the declaration, component or export the document came from. */
  name: z.string().min(1),
  document: z.record(z.string(), z.unknown()).refine((value) => value.$schema === DIALECT_2020_12, {
    message: `a stored document declares "$schema": ${JSON.stringify(DIALECT_2020_12)}`,
    path: ['$schema'],
  }),
  source: SourceDescriptorSchema,
  /** Every diagnostic the import produced, replayed on every later read. Empty for a clean import. */
  diagnostics: z.array(DiagnosticSchema),
})

export type SchemaSnapshot = z.infer<typeof SchemaSnapshotSchema>

/** SHA-256 as the evidence stores it: lowercase hex, no separators. */
const Sha256Hex = z.string().regex(/^[0-9a-f]{64}$/, 'a bodyHash is a lowercase hex SHA-256')

/**
 * What laqi knows about the body it generated. Present only when laqi
 * generated the current body from the snapshot; a hand-written or
 * hand-edited body has none.
 */
export const GenerationEvidenceSchema = z.strictObject({
  /** Always recorded. When the caller supplies none, laqi allocates one. */
  seed: z.number().int(),
  /**
   * Effective values, not requested ones. `arrayLength` is always present;
   * any future input that changes the output joins it here.
   */
  options: z.looseObject({ arrayLength: z.number().int().positive() }),
  /** Over the body as written, in the same operation that wrote it. */
  bodyHash: Sha256Hex,
})

export type GenerationEvidence = z.infer<typeof GenerationEvidenceSchema>
