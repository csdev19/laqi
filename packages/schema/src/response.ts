import { z } from 'zod'
import { STATUS_MAX, STATUS_MIN } from './status-codes'

/** A mock should never take more than a minute; beyond that, it's a typo. */
export const MAX_DELAY_MS = 60_000

/**
 * The model a generated body came from, kept beside the body it produced.
 *
 * A body cannot be turned back into the model that made it: JSON has no
 * literal unions, no optional fields that happen to be absent, and no
 * tuples. Storing the source is the only way the panel can show what was
 * actually pasted, and the only way `regenerate` can reproduce the shape
 * instead of guessing it from one sample.
 *
 * Optional, and only ever written by the generator. A hand-written response
 * has no model, and a body edited by hand keeps whatever model was there —
 * it says where the body came from, not what the body currently is.
 */
export const GeneratedFromSchema = z.object({
  /** The declaration inside `model` the body was generated from. */
  typeName: z.string().min(1),
  /** The source exactly as it was pasted, every declaration included. */
  model: z.string().min(1),
})

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
