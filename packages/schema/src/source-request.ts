import { z } from 'zod'

/**
 * What a transport hands to `importSchema`.
 *
 * A discriminated union rather than one entry point per kind, so the panel,
 * the HTTP control plane and MCP all build the same thing and exactly one
 * place — the composition root in `@laqi/generate` — knows which adapter
 * serves which kind. It lives here, beside the stored `SourceDescriptor`,
 * because it is a wire contract two transports validate, not an internal
 * detail of the generator.
 *
 * A runtime object never travels over HTTP or MCP: `project-module` carries
 * a descriptor and the object is produced locally, under the module-loading
 * rules.
 */
export const SourceRequestSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('typescript-paste'),
    source: z.string().min(1),
    typeName: z.string().min(1).optional(),
  }),
  z.object({
    kind: z.literal('json-schema'),
    document: z.unknown(),
    name: z.string().min(1).optional(),
    /** Where the document was read from, so a refresh can read it again. */
    file: z.string().min(1).optional(),
  }),
  z.object({
    kind: z.literal('project-module'),
    /** Relative to `schemaSources.root`. Resolved and confined before anything is read. */
    file: z.string().min(1),
    exportName: z.string().min(1),
    /**
     * Which Standard JSON Schema conversion to ask for. A response is what
     * the API gives back, so `output` is the default; `input` is for the
     * shape a caller must send, which is a different document whenever the
     * schema has a default or a transform.
     */
    side: z.enum(['input', 'output']).default('output'),
  }),
])

export type SourceRequest = z.infer<typeof SourceRequestSchema>

/** Every kind the composition root serves, for the message when one is not. */
export const KNOWN_SOURCE_KINDS = ['typescript-paste', 'json-schema', 'project-module'] as const
