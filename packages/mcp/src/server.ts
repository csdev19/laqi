import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { ResponseSchema, type EndpointDefinition, type LaqiConfig } from '@laqi/schema'
import { z } from 'zod'
import { importOpenapi } from './openapi'
import { Project, type ProjectResult } from './project'

const ResponsesShape = z
  .record(z.string(), ResponseSchema)
  .describe('Named responses, e.g. { "ok": { "status": 200, "body": { … } }, "boom": { "status": 500 } }')

/**
 * Un fallo de herramienta se devuelve como `isError`, no como una excepción:
 * el agente tiene que poder leer el motivo y corregir, no ver un stack.
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
        '  default  — the endpoint\'s own default, from the file',
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
        'Every mock endpoint, its declared responses, and which one is live right now with the layer that decided it. Also reports any mock file that failed to load.',
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
        'Make an endpoint serve a specific named response. Pass response=null to remove the override and fall back to the scenario or the file default. Writes .laqi/state.json, never a mock file.',
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
        'Activate a named scenario from scenarios.json, moving every endpoint it covers at once. Pass name=null to deactivate. Only one scenario is active at a time.',
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
        'Clear every override and deactivate the scenario, returning all endpoints to the defaults declared in their files.',
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
        'Add a new mock endpoint and write it to the project mock files. Path params use a colon: /users/:id.',
      inputSchema: {
        method: z.string().describe('GET, POST, PUT, PATCH, DELETE, HEAD or OPTIONS'),
        path: z.string().describe('Route path starting with "/", e.g. /users/:id'),
        description: z.string().optional(),
        default: z.string().describe('Which named response is served by default'),
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
    'update_endpoint',
    {
      title: 'Update an endpoint',
      description:
        'Replace an endpoint definition, writing back to the file it came from. This is a full replacement: responses you omit are removed.',
      inputSchema: {
        id: z.string().describe('Endpoint id, e.g. "GET /users/:id"'),
        description: z.string().optional(),
        default: z.string(),
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
      description: 'Remove an endpoint from the file it lives in, and drop any override pointing at it.',
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
        'Create mock endpoints from an OpenAPI 3.x document, generating example bodies from the schemas. The document must be JSON — convert YAML before calling. Reports what it skipped and why, and never overwrites an endpoint that already exists unless overwrite is true.',
      inputSchema: {
        document: z.unknown().describe('The parsed OpenAPI 3.x document, as JSON'),
        overwrite: z
          .boolean()
          .optional()
          .describe('Replace endpoints that already exist (default false: they are reported as skipped)'),
      },
    },
    ({ document, overwrite }) => {
      const imported = importOpenapi(document)
      const created: string[] = []
      const updated: string[] = []
      const skipped = [...imported.skipped]

      for (const endpoint of imported.endpoints) {
        const result = project.createEndpoint({
          method: endpoint.method,
          path: endpoint.path,
          description: endpoint.definition.description,
          default: endpoint.definition.default,
          responses: endpoint.definition.responses,
        })

        if (result.ok) {
          created.push(result.value.id)
          continue
        }

        const id = `${endpoint.method} ${endpoint.path}`
        if (!overwrite) {
          skipped.push({ where: id, reason: result.error })
          continue
        }

        const replaced = project.updateEndpoint(id, endpoint.definition)
        if (replaced.ok) updated.push(id)
        else skipped.push({ where: id, reason: replaced.error })
      }

      return text({ created, updated, skipped })
    },
  )

  return server
}
