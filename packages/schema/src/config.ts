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
  /**
   * Where a schema source may be read from, relative to the project root.
   *
   * Separate from `dir`/`file` on purpose: those bound where laqi WRITES,
   * and a project's types legitimately live outside the mocks folder —
   * `src/types/api.ts` is the ordinary case. A source path never grants a
   * write anywhere, and a write bound never widens what may be read.
   */
  schemaSources: z.object({ root: z.string().default('.') }).default({ root: '.' }),
  /**
   * The only project modules MCP may execute.
   *
   * Importing a module runs it and everything it imports, so an agent that
   * could name any file could run any file. The panel asks a person instead;
   * an agent has no one to ask, so the answer is written down here in
   * advance, by hand, in a file MCP cannot write.
   */
  mcp: z
    .object({
      modules: z
        .array(
          z.object({
            file: z.string().min(1),
            exportName: z.string().min(1),
            side: z.enum(['input', 'output']).default('output'),
          }),
        )
        .default([]),
    })
    .default({ modules: [] }),
  /** Panel preferences (finding H12). */
  density: z.enum(['regular', 'compact']).default('regular'),
  showDescriptions: z.boolean().default(true),
})

export type LaqiConfig = z.infer<typeof ConfigSchema>
