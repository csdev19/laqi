import { z } from 'zod'

export const ConfigSchema = z.object({
  /** 0 = ephemeral port assigned by the OS; used by the tests. */
  port: z.number().int().min(0).max(65535).default(8000),
  host: z.string().default('127.0.0.1'),
  /** Mocks folder (folder mode). */
  dir: z.string().default('laqi'),
  /** Single file (file mode). Used if `dir` doesn't exist. */
  file: z.string().default('laqi.json'),
  /** '*' or an allowlist of origins. Never '*' with --share (ADR-0007). */
  cors: z.union([z.literal('*'), z.array(z.string())]).default('*'),
  /** Panel preferences (finding H12). */
  density: z.enum(['regular', 'compact']).default('regular'),
  showDescriptions: z.boolean().default(true),
})

export type LaqiConfig = z.infer<typeof ConfigSchema>
