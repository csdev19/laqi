import { z } from 'zod'
import { STATUS_MAX, STATUS_MIN } from './status-codes'

/** A mock should never take more than a minute; beyond that, it's a typo. */
export const MAX_DELAY_MS = 60_000

/**
 * The local generation recipe a body came from, kept beside the body it produced.
 *
 * A body cannot be turned back into the recipe that made it: JSON has no
 * literal unions, no optional fields that happen to be absent, and no
 * tuples. The recipe preserves those rules without storing a readable type
 * definition that could be mistaken for the API contract.
 *
 * Optional, and only ever written by the generator. A hand-written response
 * has no recipe, and a body edited by hand keeps whatever recipe was there —
 * it says where the body came from, not what the body currently is.
 */
const RecipeGeneratedFromSchema = z.object({
  /** A helpful provenance label, never a declaration of the API contract. */
  typeName: z.string().min(1),
  /** Compact, tool-owned JSON metadata decoded by @laqi/generate. */
  recipe: z.union([z.string(), z.array(z.unknown())]),
})

/**
 * Compatibility for mock files written by the unmerged source-storage
 * experiment. New writes always use RecipeGeneratedFromSchema; keeping this
 * readable only long enough to load old local projects avoids data loss.
 */
const LegacyModelGeneratedFromSchema = z.object({
  typeName: z.string().min(1),
  model: z.string().min(1),
})

export const GeneratedFromSchema = z.union([
  RecipeGeneratedFromSchema,
  LegacyModelGeneratedFromSchema,
])

export type GeneratedFrom = z.infer<typeof GeneratedFromSchema>

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
  generatedFrom: GeneratedFromSchema.optional(),
})

export type MockResponse = z.infer<typeof ResponseSchema>
