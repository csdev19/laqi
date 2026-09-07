import { z } from 'zod'
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
})

export type MockResponse = z.infer<typeof ResponseSchema>
