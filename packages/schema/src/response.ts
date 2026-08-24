import { z } from 'zod'

/** Un mock nunca debería tardar más de un minuto; más allá es un typo. */
export const MAX_DELAY_MS = 60_000

export const ResponseSchema = z.object({
  status: z.number().int().min(100).max(599),
  body: z.unknown().optional(),
  delay: z.number().int().min(0).max(MAX_DELAY_MS).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  description: z.string().optional(),
})

export type MockResponse = z.infer<typeof ResponseSchema>
