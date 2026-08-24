import { z } from 'zod'

export const ConfigSchema = z.object({
  /** 0 = puerto efímero asignado por el SO; lo usan los tests. */
  port: z.number().int().min(0).max(65535).default(8000),
  host: z.string().default('127.0.0.1'),
  /** Carpeta de mocks (modo carpeta). */
  dir: z.string().default('laqi'),
  /** Archivo único (modo archivo). Se usa si `dir` no existe. */
  file: z.string().default('laqi.json'),
  /** '*' o una lista blanca de orígenes. Nunca '*' con --share (ADR-0007). */
  cors: z.union([z.literal('*'), z.array(z.string())]).default('*'),
  /** Preferencias del panel (hallazgo H12). */
  density: z.enum(['regular', 'compact']).default('regular'),
  showDescriptions: z.boolean().default(true),
})

export type LaqiConfig = z.infer<typeof ConfigSchema>
