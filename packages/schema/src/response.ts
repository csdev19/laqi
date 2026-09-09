import { z } from 'zod'
import { GenerationEvidenceSchema, SchemaSnapshotSchema } from './schema-snapshot'
import { STATUS_MAX, STATUS_MIN } from './status-codes'

/** A mock should never take more than a minute; beyond that, it's a typo. */
export const MAX_DELAY_MS = 60_000

export const ResponseSchema = z.object({
  status: z
    .number()
    .int()
    .min(STATUS_MIN, `a status is a number from ${STATUS_MIN} to ${STATUS_MAX}`)
    .max(STATUS_MAX, `a status is a number from ${STATUS_MIN} to ${STATUS_MAX}`),
  body: z.unknown().optional(),
  delay: z.number().int().min(0).max(MAX_DELAY_MS).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  description: z.string().optional(),
  /**
   * The schema this response is associated with. Independent of how the body
   * was obtained: an OpenAPI example has one and was never generated.
   */
  schema: SchemaSnapshotSchema.optional(),
  /** Present only when laqi generated the body this response currently holds. */
  generation: GenerationEvidenceSchema.optional(),
  /**
   * Two experiments stored generation metadata here before the schema did:
   * the pasted TypeScript, then a packed Shape. Neither gets a compatibility
   * branch, and neither may be quietly dropped either — a mock whose
   * provenance vanished on load would regenerate from nothing with no
   * explanation. Declared so it is refused by name, with what replaced it.
   */
  generatedFrom: z
    .never({
      error:
        '"generatedFrom" is no longer stored; a generated response carries "schema" and "generation" instead',
    })
    .optional(),
})

export type MockResponse = z.infer<typeof ResponseSchema>
