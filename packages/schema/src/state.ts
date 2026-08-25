import { z } from 'zod'

export const StateSchema = z.object({
  scenario: z.string().nullable().default(null),
  overrides: z.record(z.string(), z.string()).default({}),
})

export type LaqiState = z.infer<typeof StateSchema>

export const DEFAULT_STATE: LaqiState = { scenario: null, overrides: {} }
