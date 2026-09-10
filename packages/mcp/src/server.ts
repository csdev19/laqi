import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  ResponseSchema,
  SourceRequestSchema,
  type EndpointDefinition,
  type LaqiConfig,
} from '@laqi/schema'
import { z } from 'zod'
import { MAX_SOURCE_LENGTH } from '@laqi/generate'
import { importOpenapi } from './openapi'
import { ModuleApprovals, Project, refreshRequestFor, type ProjectResult } from '@laqi/core'

/**
 * The wire form of a source, declared here so an agent reads the shapes it
 * may send. The union itself is the schema package's, so this transport
 * cannot drift from what the importer accepts.
 */
const SourceRequestShape = SourceRequestSchema

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
  /**
   * MCP never redeems a panel token — it holds this only for the written-down
   * list. The two approvals mean different things: one is a person looking at
   * a file right now, the other is a standing decision about a project.
   */
  const approvals = new ModuleApprovals(options.root, options.config)

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
        'Export a data model for one response of an endpoint, in any supported language (default "typescript"; try "typescript-zod", "swift", "kotlin", "python", …). Exported from the stored JSON Schema when the response has one, and inferred from the live body otherwise. The first line of the output says which.',
      inputSchema: {
        endpointId: z.string().describe('Endpoint id, e.g. "GET /users/:id"'),
        response: z.string().optional().describe('Response name; defaults to the endpoint default'),
        lang: z.string().optional().describe('Target language name'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ endpointId, response, lang }) => {
      const found = project.getResponse(endpointId, response)
      if (!found.ok)
        return { isError: true, content: [{ type: 'text' as const, text: found.error }] }

      const { inferShape, printDocument, printTypes, typeNameFor } = await import('@laqi/generate')
      try {
        // The stored schema states what the response may contain; the body is
        // one sample. An agent gets the better source when there is one, and
        // is told which it got — it cannot see the file to judge for itself.
        const snapshot = found.value.schema
        const printed = snapshot
          ? await printDocument(snapshot.document, { typeName: snapshot.name, lang })
          : await printTypes(inferShape(found.value.body ?? null), {
              typeName: typeNameFor(endpointId),
              lang,
            })
        const origin = snapshot
          ? `// exported from the ${snapshot.name} schema this response carries`
          : '// derived from the response body — this response carries no schema'
        return { content: [{ type: 'text' as const, text: `${origin}\n${printed.code}` }] }
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
        'Use this for a realistic body — an array of users, a paginated list — instead of hand-writing fake values: from a pasted TypeScript model, a JSON Schema document (source), or the schema an existing response carries (from). Returns a preview; write it with apply_generated_body. Same seed, same output. Strict by default: an import that would lose what the source said is refused, naming what would have been approximated. Pass allowLoss only after showing that to the person.',
      inputSchema: {
        source: SourceRequestShape.optional().describe(
          'Any source laqi can import, e.g. { "kind": "json-schema", "document": { … } }',
        ),
        allowLoss: z
          .boolean()
          .optional()
          .describe('Accept the approximations the reply names. Ask the person first.'),
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
    async ({ source, allowLoss, model, typeName, from, arrayLength, seed }) => {
      const { compileSchema, importSchema, previewBody } = await import('@laqi/generate')
      const genOptions = { arrayLength, seed }
      const importOptions = {
        allowLoss: allowLoss === true,
        paths: { root: options.root, sourceRoot: options.config.schemaSources.root },
      }

      // Same shape as get_types just above: a malformed model or an
      // unrepresentable shape (a depth-guard trip in inferShape, a
      // generation-budget overrun in generate()) is a tool-input problem,
      // not a crash. The MCP SDK does catch an escaped exception on its
      // own, but only with a generic message — this keeps the reported
      // error explicit and consistent with get_types.
      try {
        // `model` is the shorthand for the commonest source; `source` is the
        // same path with any kind. One import call for both, so a loss is
        // refused identically however the caller spelled it.
        const request =
          source ??
          (model === undefined
            ? undefined
            : ({
                kind: 'typescript-paste',
                source: model,
                ...(typeName === undefined ? {} : { typeName }),
              } as const))

        if (request !== undefined) {
          // An agent has nobody to ask, so the answer was written down in
          // advance. Checked before anything is resolved or read: the point
          // is that an unlisted module is never reached at all.
          if (request.kind === 'project-module') {
            const asked = {
              file: request.file,
              exportName: request.exportName,
              side: request.side,
            }
            if (!approvals.allowedForAgents(asked)) {
              return {
                isError: true,
                content: [{ type: 'text' as const, text: approvals.refusalForAgents(asked) }],
              }
            }
          }

          const { snapshot, candidates } = await importSchema(request, importOptions)
          const preview = await previewBody(snapshot, genOptions)
          return text({
            preview: preview.body,
            schema: snapshot,
            generation: preview.evidence,
            diagnostics: snapshot.diagnostics,
            // Which declaration was used is invisible in the body, and a
            // paste that declares several silently mocks whichever came
            // first. Named whenever there was a choice.
            ...(candidates.length > 1 ? { typeName: snapshot.name, candidates } : {}),
            warnings: snapshot.diagnostics.map((item) => item.message),
          })
        }
        if (from !== undefined) {
          const found = project.getResponse(from.endpointId, from.response)
          if (!found.ok)
            return { isError: true, content: [{ type: 'text' as const, text: found.error }] }
          const snapshot = found.value.schema
          if (!snapshot) {
            return {
              isError: true,
              content: [
                {
                  type: 'text' as const,
                  text:
                    `${from.endpointId} has no schema for ${JSON.stringify(from.response)}, so there is ` +
                    'nothing to regenerate from. Inferring one from the body would silently drop literal ' +
                    'unions, absent optionals and tuple arity; create the response from a model or a ' +
                    'JSON Schema first.',
                },
              ],
            }
          }
          const compiled = compileSchema(snapshot.document)
          if (!compiled.ok) {
            return {
              isError: true,
              content: [
                {
                  type: 'text' as const,
                  text: compiled.diagnostics[0]?.message ?? 'the stored schema no longer compiles',
                },
              ],
            }
          }
          const preview = await previewBody(snapshot, genOptions)
          return text({
            preview: preview.body,
            generation: preview.evidence,
            warnings: snapshot.diagnostics.map((item) => item.message),
          })
        }
        return {
          isError: true,
          content: [{ type: 'text' as const, text: 'pass one of "model", "source" or "from"' }],
        }
      } catch (error) {
        return { isError: true, content: [{ type: 'text' as const, text: errorMessage(error) }] }
      }
    },
  )

  server.registerTool(
    'regenerate_response',
    {
      title: 'Regenerate a response body',
      description:
        'Generate a fresh body for a response from the JSON Schema it already carries. Returns a preview and the revision it was generated against; it writes nothing. Pass both to apply_generated_body to keep it. A response with no schema is refused rather than guessed at: inferring a shape back from one sample cannot see a literal union, an absent optional or a fixed-length tuple.',
      inputSchema: {
        endpointId: z.string().describe('Endpoint id, e.g. "GET /users/:id"'),
        response: z.string().optional().describe('Response name; defaults to the endpoint default'),
        arrayLength: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe('How many items for a top-level array'),
        seed: z.number().int().optional().describe('Fix this to get the same output on every call'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ endpointId, response, arrayLength, seed }) => {
      const found = project.getResponse(endpointId, response)
      if (!found.ok)
        return { isError: true, content: [{ type: 'text' as const, text: found.error }] }

      const snapshot = found.value.schema
      if (!snapshot) {
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text:
                `${endpointId} has no schema for ${JSON.stringify(response ?? 'its default response')}, so there is ` +
                'nothing to regenerate from. Create the response from a model or a JSON Schema first.',
            },
          ],
        }
      }

      const revision = project.getResponseRevision(endpointId, response)
      if (!revision.ok)
        return { isError: true, content: [{ type: 'text' as const, text: revision.error }] }

      const { previewBody } = await import('@laqi/generate')
      try {
        const preview = await previewBody(snapshot, { arrayLength, seed })
        return text({
          preview: preview.body,
          generation: preview.evidence,
          revision: revision.value,
          diagnostics: preview.diagnostics,
        })
      } catch (error) {
        return { isError: true, content: [{ type: 'text' as const, text: errorMessage(error) }] }
      }
    },
  )

  server.registerTool(
    'apply_generated_body',
    {
      title: 'Write a generated body to a response',
      description:
        'Write a body produced by regenerate_response or generate_data, together with the evidence that reproduces it. Pass the revision that came back with the preview. This can be refused: if the response changed since then, or if the body being replaced is not one laqi generated (hand-written, or edited afterwards), the reply names the reason and the current revision. Show the person what would be overwritten, then retry with that revision and confirm: true.',
      inputSchema: {
        endpointId: z.string().describe('Endpoint id, e.g. "GET /users/:id"'),
        response: z.string().optional().describe('Response name; defaults to the endpoint default'),
        body: z.unknown().describe('The generated body, exactly as the preview returned it'),
        generation: z.unknown().describe('The evidence the preview returned beside the body'),
        revision: z.string().describe('The revision the preview was generated against'),
        confirm: z
          .boolean()
          .optional()
          .describe('Overwrite a body laqi did not generate. Ask the person first.'),
      },
    },
    ({ endpointId, response, body, generation, revision, confirm }) => {
      const result = project.applyGeneratedBody({
        id: endpointId,
        response,
        body,
        generation,
        revision,
        confirm,
      })

      if (!result.ok && result.conflict) {
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  conflict: result.conflict.reason,
                  message: result.error,
                  revision: result.conflict.revision,
                },
                null,
                2,
              ),
            },
          ],
        }
      }
      return reply(result)
    },
  )

  server.registerTool(
    'refresh_schema',
    {
      title: 'Re-read the source of a stored schema',
      description:
        "Re-read the file a response's schema was imported from and store the new version. The body is not touched and not regenerated: use regenerate_response for that, so the change to the served data is a separate, visible step. A schema imported from pasted TypeScript has no source to re-read.",
      inputSchema: {
        endpointId: z.string().describe('Endpoint id, e.g. "GET /users/:id"'),
        response: z.string().optional().describe('Response name; defaults to the endpoint default'),
        revision: z.string().describe('The revision you last read for this response'),
        allowLoss: z
          .boolean()
          .optional()
          .describe(
            'Store the approximations the diagnostics name. Show them to the person first.',
          ),
      },
    },
    async ({ endpointId, response, revision, allowLoss }) => {
      const found = project.getResponse(endpointId, response)
      if (!found.ok)
        return { isError: true, content: [{ type: 'text' as const, text: found.error }] }

      const request = refreshRequestFor({
        snapshot: found.value.schema,
        root: options.root,
        sourceRoot: options.config.schemaSources.root,
      })
      if (!request.ok)
        return { isError: true, content: [{ type: 'text' as const, text: request.error }] }

      const { importSchema } = await import('@laqi/generate')
      let snapshot
      try {
        snapshot = (await importSchema(request.value, { allowLoss: allowLoss === true })).snapshot
      } catch (error) {
        return { isError: true, content: [{ type: 'text' as const, text: errorMessage(error) }] }
      }

      const result = project.refreshSchema({ id: endpointId, response, schema: snapshot, revision })
      if (!result.ok && result.conflict) {
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  conflict: result.conflict.reason,
                  message: result.error,
                  revision: result.conflict.revision,
                },
                null,
                2,
              ),
            },
          ],
        }
      }
      if (!result.ok) return reply(result)
      return text({ schema: snapshot, revision: result.value.revision })
    },
  )

  return server
}
