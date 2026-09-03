import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { ResponseSchema, type EndpointDefinition, type LaqiConfig } from '@laqi/schema'
import { z } from 'zod'
import { MAX_SOURCE_LENGTH } from '@laqi/generate'
import { importOpenapi } from './openapi'
import { Project, type ProjectResult } from '@laqi/core'

const ResponsesShape = z
  .record(z.string(), ResponseSchema)
  .describe(
    'Named responses, e.g. { "ok": { "status": 200, "body": { … } }, "boom": { "status": 500 } }',
  )

/**
 * A tool failure is returned as `isError`, not as a thrown exception: the
 * agent needs to be able to read the reason and correct course, not see a
 * stack trace.
 */
function reply<T>(result: ProjectResult<T>) {
  if (!result.ok) {
    return { isError: true, content: [{ type: 'text' as const, text: result.error }] }
  }
  return { content: [{ type: 'text' as const, text: JSON.stringify(result.value, null, 2) }] }
}

function text(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] }
}

/**
 * @laqi/generate's Effect-based facades (printTypes, generate) reject
 * through Effect's FiberFailure, whose `name`/`toString()` carry a
 * "(FiberFailure) SomeError" prefix — internal plumbing, not something a
 * user should see. `.message` itself is already clean (Effect puts only the
 * tagged error's own message there), so reading through it IS the
 * unwrapping. One place for both get_types and generate_data to catch
 * through, so neither has to know about FiberFailure on its own.
 */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function createMcpServer(options: { root: string; config: LaqiConfig }): McpServer {
  const project = new Project(options.root, options.config)

  const server = new McpServer(
    { name: 'laqi', version: '2.0.0' },
    {
      instructions: [
        'laqi is a mock HTTP server. These tools edit the mock definitions in the',
        'project and choose which response each endpoint serves right now.',
        '',
        'An endpoint id is "METHOD /path", e.g. "GET /users/:id". Path params use',
        'a colon, not braces.',
        '',
        'Which response is served is decided by layers, highest first:',
        '  state    — a per-endpoint override you set with set_response',
        '  scenario — the active scenario, set with set_scenario',
        "  default  — the endpoint's own default, from the file",
        'An override beats the active scenario. Use set_response with response=null',
        'to drop an override rather than setting it back to the default by name.',
        '',
        'Changes take effect immediately on a running laqi server, and are safe to',
        'make while it is stopped.',
      ].join('\n'),
    },
  )

  server.registerTool(
    'list_endpoints',
    {
      title: 'List endpoints',
      description:
        'Every mock endpoint, its declared responses, and which one is live right now with the layer that decided it. Also reports any mock file that failed to load. Call this before create_endpoint, so you extend a route that already exists instead of duplicating it.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    () => reply(project.listEndpoints()),
  )

  server.registerTool(
    'get_state',
    {
      title: 'Get active state',
      description:
        'What is currently overridden and why: the active scenario, the per-endpoint overrides, and the endpoints that are not on their file default.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    () => reply(project.getState()),
  )

  server.registerTool(
    'set_response',
    {
      title: 'Set the live response',
      description:
        'Make an endpoint serve a specific named response right now, with no file edit — e.g. force the 500 or the empty state your frontend needs to handle. Pass response=null to remove the override and fall back to the active scenario or the file default; an unknown response name is rejected with the declared ones listed. Beats the active scenario. Writes .laqi/state.json, never a mock file — for a change that should persist, use update_endpoint instead.',
      inputSchema: {
        id: z.string().describe('Endpoint id, e.g. "GET /users/:id"'),
        response: z
          .string()
          .nullable()
          .describe('A declared response name, or null to clear the override'),
      },
      annotations: { idempotentHint: true },
    },
    ({ id, response }) => reply(project.setResponse(id, response)),
  )

  server.registerTool(
    'set_scenario',
    {
      title: 'Activate a scenario',
      description:
        "Activate a named scenario from scenarios.json, moving every endpoint it covers at once — use this to switch a whole flow (e.g. 'offline', 'logged-out') instead of calling set_response endpoint by endpoint. A set_response override still beats the active scenario on any endpoint it targets. Pass name=null to deactivate; an unknown scenario name is rejected with the declared ones listed. Only one scenario is active at a time.",
      inputSchema: {
        name: z.string().nullable().describe('Scenario name, or null to deactivate'),
      },
      annotations: { idempotentHint: true },
    },
    ({ name }) => reply(project.setScenario(name)),
  )

  server.registerTool(
    'reset_state',
    {
      title: 'Reset to file defaults',
      description:
        'Clear every set_response override and deactivate the active scenario, returning all endpoints to the defaults declared in their files. Use this to get back to a known state before starting a new test.',
      inputSchema: {},
      annotations: { idempotentHint: true },
    },
    () => reply(project.resetState()),
  )

  server.registerTool(
    'create_endpoint',
    {
      title: 'Create an endpoint',
      description:
        "Use this when the frontend needs a route the backend hasn't built yet. Adds a new mock endpoint and writes it to the project mock files. Path params use a colon: /users/:id. Check list_endpoints first so you don't recreate one that already exists — it fails with a clear error anyway. For a realistic body instead of hand-written values, pair with generate_data.",
      inputSchema: {
        method: z.string().describe('GET, POST, PUT, PATCH, DELETE, HEAD or OPTIONS'),
        path: z.string().describe('Route path starting with "/", e.g. /users/:id'),
        description: z.string().optional().describe('Human-readable note about the endpoint'),
        default: z
          .string()
          .describe('Which named response is served by default — must be a key in responses'),
        responses: ResponsesShape,
      },
    },
    (input) =>
      reply(
        project.createEndpoint({
          method: input.method,
          path: input.path,
          description: input.description,
          default: input.default,
          responses: input.responses,
        }),
      ),
  )

  server.registerTool(
    'scaffold_responses',
    {
      title: 'Scaffold the usual responses',
      description:
        'Add the responses this endpoint probably needs and does not have yet, chosen by its method and path shape: a GET on a collection gets an `empty`, a GET on /:id gets a `not-found`, a POST gets `validation-error` and `conflict`. Bodies are placeholders — replace them with generate_data. This only ever ADDS: existing responses keep their bodies, and the default does not move. Safe to call twice.',
      inputSchema: { id: z.string().describe('Endpoint id, e.g. "GET /users/:id"') },
    },
    ({ id }) => {
      const result = project.scaffoldResponses(id)
      if (!result.ok) return reply(result)

      if (result.value.added.length === 0) {
        return text({
          id,
          added: [],
          message: `${id} already has every response laqi would suggest.`,
        })
      }
      return text(result.value)
    },
  )

  server.registerTool(
    'update_endpoint',
    {
      title: 'Update an endpoint',
      description:
        'Change what an existing endpoint can return — add a response, edit a body, change the default — by replacing its whole definition in the file it came from. This is a full replacement: responses you omit are removed, so include every response you want to keep. For flipping between responses that already exist, without editing the file, use set_response instead.',
      inputSchema: {
        id: z.string().describe('Endpoint id, e.g. "GET /users/:id"'),
        description: z.string().optional().describe('Human-readable note about the endpoint'),
        default: z
          .string()
          .describe('Which named response is served by default — must be a key in responses'),
        responses: ResponsesShape,
      },
    },
    ({ id, description, default: fallback, responses }) => {
      const definition: EndpointDefinition = { description, default: fallback, responses }
      return reply(project.updateEndpoint(id, definition))
    },
  )

  server.registerTool(
    'delete_endpoint',
    {
      title: 'Delete an endpoint',
      description:
        'Remove an endpoint from the file it lives in, and drop any override pointing at it.',
      inputSchema: { id: z.string().describe('Endpoint id, e.g. "GET /users/:id"') },
      annotations: { destructiveHint: true },
    },
    ({ id }) => reply(project.deleteEndpoint(id)),
  )

  server.registerTool(
    'import_openapi',
    {
      title: 'Import an OpenAPI document',
      description:
        'Use this when you already have an OpenAPI/Swagger document for the API you are mocking, instead of calling create_endpoint per route. Creates mock endpoints from an OpenAPI 3.x document, generating example bodies from the schemas. The document must be JSON — convert YAML before calling. Reports what it skipped and why, and never overwrites an endpoint that already exists unless overwrite is true.',
      inputSchema: {
        document: z.unknown().describe('The parsed OpenAPI 3.x document, as JSON'),
        overwrite: z
          .boolean()
          .optional()
          .describe(
            'Replace endpoints that already exist (default false: they are reported as skipped)',
          ),
      },
    },
    ({ document, overwrite }) => {
      const imported = importOpenapi(document)
      const skipped = [...imported.skipped]

      // One load and one write for the whole spec. It used to be one call
      // per operation, and each one reloaded the entire project.
      const batch = project.createEndpoints(
        imported.endpoints.map((endpoint) => ({
          method: endpoint.method,
          path: endpoint.path,
          description: endpoint.definition.description,
          default: endpoint.definition.default,
          responses: endpoint.definition.responses,
        })),
      )
      if (!batch.ok)
        return { isError: true, content: [{ type: 'text' as const, text: batch.error }] }

      const created = batch.value.created
      const updated: string[] = []

      const byId = new Map(
        imported.endpoints.map((endpoint) => [
          `${endpoint.method} ${endpoint.path}`,
          endpoint.definition,
        ]),
      )

      for (const rejection of batch.value.rejected) {
        const definition = byId.get(rejection.id)
        if (!overwrite || definition === undefined) {
          skipped.push({ where: rejection.id, reason: rejection.error })
          continue
        }

        const replaced = project.updateEndpoint(rejection.id, definition)
        if (replaced.ok) updated.push(rejection.id)
        else skipped.push({ where: rejection.id, reason: replaced.error })
      }

      return text({ created, updated, skipped })
    },
  )

  server.registerTool(
    'get_types',
    {
      title: 'Get the types of an endpoint',
      description:
        'Derive a data model from the live response body of an endpoint, in any supported language (default "typescript"; try "typescript-zod", "swift", "kotlin", "python", …). Types are derived from the data on demand, so they are never stale.',
      inputSchema: {
        endpointId: z.string().describe('Endpoint id, e.g. "GET /users/:id"'),
        response: z.string().optional().describe('Response name; defaults to the endpoint default'),
        lang: z.string().optional().describe('Target language name'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ endpointId, response, lang }) => {
      const body = project.getResponseBody(endpointId, response)
      if (!body.ok) return { isError: true, content: [{ type: 'text' as const, text: body.error }] }

      const { inferShape, printTypes, typeNameFor } = await import('@laqi/generate')
      try {
        const printed = await printTypes(inferShape(body.value ?? null), {
          typeName: typeNameFor(endpointId),
          lang,
        })
        return { content: [{ type: 'text' as const, text: printed.code }] }
      } catch (error) {
        return { isError: true, content: [{ type: 'text' as const, text: errorMessage(error) }] }
      }
    },
  )

  server.registerTool(
    'generate_data',
    {
      title: 'Generate mock data',
      description:
        'Use this for a realistic body — an array of users, a paginated list — instead of hand-writing fake values: generate from a pasted TypeScript model, or regenerate from the shape of an existing response (from). Returns a preview; write it with create_endpoint or update_endpoint. Same seed, same output.',
      inputSchema: {
        // Declared here as well as enforced inside parseTypes, so the limit
        // is part of the advertised schema: an agent reads it before
        // streaming a whole file down the pipe, instead of after.
        model: z
          .string()
          .max(MAX_SOURCE_LENGTH)
          .optional()
          .describe('TypeScript source containing the interface/type'),
        typeName: z
          .string()
          .optional()
          .describe('Which exported type to generate, when model declares more than one'),
        from: z
          .object({
            endpointId: z.string().describe('Endpoint id, e.g. "GET /users/:id"'),
            response: z
              .string()
              .describe("Which of that endpoint's declared responses to shape from"),
          })
          .optional()
          .describe('Regenerate from the shape of an existing response, instead of a model'),
        arrayLength: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe('How many items for a top-level or inferred array (default a small number)'),
        seed: z.number().int().optional().describe('Fix this to get the same output on every call'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ model, typeName, from, arrayLength, seed }) => {
      const { generate, inferShape, parseTypes } = await import('@laqi/generate')
      const genOptions = { arrayLength, seed }

      // Same shape as get_types just above: a malformed model or an
      // unrepresentable shape (a depth-guard trip in inferShape, a
      // generation-budget overrun in generate()) is a tool-input problem,
      // not a crash. The MCP SDK does catch an escaped exception on its
      // own, but only with a generic message — this keeps the reported
      // error explicit and consistent with get_types.
      try {
        if (model !== undefined) {
          const parsed = await parseTypes(model, typeName)
          if (!parsed.ok)
            return { isError: true, content: [{ type: 'text' as const, text: parsed.error }] }
          const preview = await generate(parsed.shape, genOptions)
          return text({ preview, warnings: parsed.warnings })
        }
        if (from !== undefined) {
          const body = project.getResponseBody(from.endpointId, from.response)
          if (!body.ok)
            return { isError: true, content: [{ type: 'text' as const, text: body.error }] }
          const preview = await generate(inferShape(body.value ?? null), genOptions)
          return text({ preview, warnings: [] })
        }
        return {
          isError: true,
          content: [{ type: 'text' as const, text: 'pass either "model" or "from"' }],
        }
      } catch (error) {
        return { isError: true, content: [{ type: 'text' as const, text: errorMessage(error) }] }
      }
    },
  )

  return server
}
