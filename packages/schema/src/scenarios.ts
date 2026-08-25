import { z } from 'zod'

export const ScenariosSchema = z.record(z.string(), z.record(z.string(), z.string()))

export type Scenarios = z.infer<typeof ScenariosSchema>
