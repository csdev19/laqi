import { join } from 'node:path'
import { loadMocks, type LoadedEndpoint, type LoadError } from './loader'
import { resolveResponse } from './resolve'
import { buildRouteTable } from './route-table'
import { StateStore } from './state-store'
import {
  createEndpointInFile,
  createEndpointsInFile,
  deleteEndpointFromFile,
  updateEndpointInFile,
} from './writer'
import {
  formatEndpointId,
  isHttpMethod,
  parseEndpointKey,
  suggestResponses,
  type EndpointDefinition,
  type HttpMethod,
  type LaqiConfig,
  type LaqiState,
  type Scenarios,
} from '@laqi/schema'

/**
 * Why it failed, so the caller can pick the right HTTP status.
 *
 * - `invalid`   the input is malformed → 400
 * - `conflict`  clashes with something that already exists → 409
 * - `not-found` what was asked to be touched doesn't exist → 404
 */
export type ProjectFailure = 'invalid' | 'conflict' | 'not-found'

export type ProjectResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; code: ProjectFailure }

const ok = <T>(value: T): ProjectResult<T> => ({ ok: true, value })
const fail = <T>(error: string, code: ProjectFailure = 'invalid'): ProjectResult<T> => ({
  ok: false,
  error,
  code,
})

export type EndpointView = {
  id: string
  method: string
  path: string
  description?: string
  file: string
  /** All declared responses, with their status. */
  responses: { name: string; status: number; delay?: number }[]
  /** The file's default. */
  default: string
  /** What's being served right now and which layer decided it. */
  live: { name: string; layer: string }
}

/**
 * Everything the MCP tools know how to do to a laqi project.
 *
 * Works directly on the files, not against a running server: the mock
 * server reads the state on every request and the watcher picks up file
 * changes, so an agent can create mocks with laqi turned off and they work
 * once you turn it on. Every operation reloads from disk because the panel,
 * the editor, and the developer themselves all write the same files.
 */
export class Project {
  private readonly store: StateStore

  constructor(
    private readonly root: string,
    private readonly config: LaqiConfig,
  ) {
    this.store = new StateStore(root)
  }

  private load(): {
    endpoints: LoadedEndpoint[]
    byId: Map<string, LoadedEndpoint>
    scenarios: Scenarios
    errors: LoadError[]
    source: 'dir' | 'file' | 'none'
  } {
    const loaded = loadMocks({ root: this.root, dir: this.config.dir, file: this.config.file })
    const { table, errors } = buildRouteTable(loaded.endpoints)
    return {
      endpoints: table.endpoints,
      byId: table.byId,
      scenarios: loaded.scenarios,
      errors: [...loaded.errors, ...errors],
      source: loaded.source,
    }
  }

  /** Where a new endpoint goes: the single file, or laqi/api.json. */
  private targetFile(source: 'dir' | 'file' | 'none'): string {
    return source === 'file' ? this.config.file : join(this.config.dir, 'api.json')
  }

  private view(endpoint: LoadedEndpoint, state: LaqiState, scenarios: Scenarios): EndpointView {
    const resolution = resolveResponse({ endpoint, state, scenarios })
    return {
      id: endpoint.id,
      method: endpoint.method,
      path: endpoint.path,
      description: endpoint.description,
      file: endpoint.file,
      responses: Object.entries(endpoint.responses).map(([name, response]) => ({
        name,
        status: response.status,
        delay: response.delay,
      })),
      default: endpoint.default,
      live: { name: resolution.name, layer: resolution.layer },
    }
  }

  listEndpoints(): ProjectResult<{ endpoints: EndpointView[]; errors: LoadError[] }> {
    const { endpoints, scenarios, errors } = this.load()
    const state = this.store.read()
    return ok({ endpoints: endpoints.map((e) => this.view(e, state, scenarios)), errors })
  }

  getState(): ProjectResult<{
    scenario: string | null
    overrides: Record<string, string>
    scenarios: string[]
    /** Only the endpoints that are NOT on their default: the rest is noise. */
    active: EndpointView[]
  }> {
    const { endpoints, scenarios } = this.load()
    const state = this.store.read()
    return ok({
      scenario: state.scenario,
      overrides: state.overrides,
      scenarios: Object.keys(scenarios),
      active: endpoints
        .map((e) => this.view(e, state, scenarios))
        .filter((view) => view.live.layer !== 'default'),
    })
  }

  createEndpoint(input: {
    method: string
    path: string
    description?: string
    default: string
    responses: EndpointDefinition['responses']
  }): ProjectResult<{ id: string; file: string }> {
    const method = input.method.toUpperCase()
    if (!isHttpMethod(method)) return fail(`unknown HTTP method ${JSON.stringify(input.method)}`)

    // The same validation that runs when loading the file: reserved prefix,
    // well-formed path, reachable segments. If this weren't done here, the
    // endpoint would get written and only fail on the next reload — the
    // user's file would end up broken by a tool that said "ok".
    // The id is built from the ALREADY NORMALIZED path that parseEndpointKey
    // returns, not from the raw one. With the raw one, a path with extra
    // spaces ("/users ") produced a different id that dodged both the
    // duplicate check and the writer's, leaving two keys that normalize to
    // the same id — a collision in the route table, killing the endpoint
    // that was already working.
    const parsed = parseEndpointKey(formatEndpointId(method as HttpMethod, input.path))
    if (!parsed.ok) return fail(parsed.error)
    const id = formatEndpointId(parsed.value.method, parsed.value.path)

    const { byId, source } = this.load()

    // Reject here and not in the writer: the writer only sees one file, and
    // in folder mode an id that already exists in ANOTHER file would get
    // written just the same — and the route table would reject both sides,
    // killing the one that was already working.
    const existing = byId.get(id)
    if (existing)
      return fail(`${JSON.stringify(id)} already exists in ${existing.file}`, 'conflict')

    const file = this.targetFile(source)
    const result = createEndpointInFile({
      root: this.root,
      file,
      id,
      definition: {
        description: input.description,
        default: input.default,
        responses: input.responses,
      },
    })

    return result.ok ? ok({ id, file }) : fail(result.error)
  }

  /**
   * Creates many endpoints at once. Exists because `import_openapi` used to
   * call `createEndpoint` once per operation, and each call reloads and
   * re-parses ALL the mock files and then rewrites the entire target file —
   * O(n^2) disk work, plus a watcher reload for every endpoint. A 150
   * operation spec did 150 of each.
   *
   * This loads once, validates everything, and writes once.
   */
  createEndpoints(
    inputs: {
      method: string
      path: string
      description?: string
      default: string
      responses: EndpointDefinition['responses']
    }[],
  ): ProjectResult<{ created: string[]; rejected: { id: string; error: string }[] }> {
    const { byId, source } = this.load()
    const file = this.targetFile(source)

    const created: string[] = []
    const rejected: { id: string; error: string }[] = []
    const definitions: { id: string; definition: EndpointDefinition }[] = []
    // New ids also count as taken: two operations from the same spec can
    // collide with each other, not just against what already existed.
    const taken = new Set(byId.keys())

    for (const input of inputs) {
      const method = input.method.toUpperCase()
      if (!isHttpMethod(method)) {
        rejected.push({
          id: `${input.method} ${input.path}`,
          error: `unknown HTTP method ${JSON.stringify(input.method)}`,
        })
        continue
      }

      // Same normalization as createEndpoint: see the comment above.
      const raw = formatEndpointId(method as HttpMethod, input.path)
      const parsed = parseEndpointKey(raw)
      if (!parsed.ok) {
        rejected.push({ id: raw, error: parsed.error })
        continue
      }
      const id = formatEndpointId(parsed.value.method, parsed.value.path)
      if (taken.has(id)) {
        rejected.push({
          id,
          error: `${JSON.stringify(id)} already exists in ${byId.get(id)?.file ?? file}`,
        })
        continue
      }

      taken.add(id)
      definitions.push({
        id,
        definition: {
          description: input.description,
          default: input.default,
          responses: input.responses,
        },
      })
      created.push(id)
    }

    if (definitions.length > 0) {
      const result = createEndpointsInFile({ root: this.root, file, entries: definitions })
      if (!result.ok) return fail(result.error)
    }

    return ok({ created, rejected })
  }

  updateEndpoint(
    id: string,
    definition: EndpointDefinition,
  ): ProjectResult<{ id: string; file: string }> {
    const existing = this.load().byId.get(id)
    if (existing === undefined) return fail(this.unknownEndpoint(id), 'not-found')

    const result = updateEndpointInFile({ root: this.root, file: existing.file, id, definition })
    return result.ok ? ok({ id, file: existing.file }) : fail(result.error)
  }

  /**
   * Adds the responses the endpoint probably wants and does not have yet,
   * chosen by its method and path shape.
   *
   * Read-modify-write happens here, on the LOADED endpoint, because that is
   * the only shape that carries bodies. Rebuilding the definition from
   * `listEndpoints` would look equivalent and would silently erase every
   * body in the file — `EndpointView.responses` is names and statuses only.
   *
   * Adding nothing is a success, not an error: asking twice is a reasonable
   * thing for an agent to do, and the second call must not rewrite the file.
   */
  scaffoldResponses(id: string): ProjectResult<{ id: string; file: string; added: string[] }> {
    const existing = this.load().byId.get(id)
    if (existing === undefined) return fail(this.unknownEndpoint(id), 'not-found')

    const missing = suggestResponses({
      method: existing.method,
      path: existing.path,
      existing: Object.keys(existing.responses),
    })

    if (missing.length === 0) return ok({ id, file: existing.file, added: [] })

    const result = updateEndpointInFile({
      root: this.root,
      file: existing.file,
      id,
      definition: {
        description: existing.description,
        // Unchanged on purpose: the scaffold adds alternatives, it does not
        // change what the server is serving right now.
        default: existing.default,
        responses: {
          ...existing.responses,
          ...Object.fromEntries(
            missing.map((suggestion) => [suggestion.name, suggestion.response]),
          ),
        },
      },
    })
    if (!result.ok) return fail(result.error)

    return ok({ id, file: existing.file, added: missing.map((suggestion) => suggestion.name) })
  }

  deleteEndpoint(id: string): ProjectResult<{ id: string; file: string }> {
    const existing = this.load().byId.get(id)
    if (existing === undefined) return fail(this.unknownEndpoint(id), 'not-found')

    const result = deleteEndpointFromFile({ root: this.root, file: existing.file, id })
    if (!result.ok) return fail(result.error)

    // An override left dangling from a deleted endpoint would make the
    // state name something that no longer exists.
    const state = this.store.read()
    if (state.overrides[id] !== undefined) {
      const overrides = { ...state.overrides }
      delete overrides[id]
      this.store.write({ ...state, overrides })
    }

    return ok({ id, file: existing.file })
  }

  /** `response: null` clears the override and returns the endpoint to its default. */
  setResponse(id: string, response: string | null): ProjectResult<EndpointView> {
    const { byId, scenarios } = this.load()
    const endpoint = byId.get(id)
    if (endpoint === undefined) return fail(this.unknownEndpoint(id), 'not-found')

    if (response !== null && !Object.hasOwn(endpoint.responses, response)) {
      return fail(
        `${JSON.stringify(response)} is not declared on ${id}. Available: ${Object.keys(endpoint.responses).join(', ')}`,
      )
    }

    const state = this.store.read()
    const overrides = { ...state.overrides }
    if (response === null) delete overrides[id]
    else overrides[id] = response

    const next = { ...state, overrides }
    this.store.write(next)
    return ok(this.view(endpoint, next, scenarios))
  }

  /** `name: null` deactivates the active scenario. */
  setScenario(
    name: string | null,
  ): ProjectResult<{ scenario: string | null; moved: EndpointView[] }> {
    const { endpoints, scenarios } = this.load()

    if (name !== null && !Object.hasOwn(scenarios, name)) {
      const available = Object.keys(scenarios)
      return fail(
        available.length === 0
          ? `no scenarios are declared — add a scenarios.json next to your mocks`
          : `unknown scenario ${JSON.stringify(name)}. Available: ${available.join(', ')}`,
      )
    }

    const state = this.store.read()
    const next = { ...state, scenario: name }
    this.store.write(next)

    return ok({
      scenario: name,
      moved: endpoints
        .map((e) => this.view(e, next, scenarios))
        .filter((view) => view.live.layer === 'scenario'),
    })
  }

  resetState(): ProjectResult<{ cleared: number }> {
    const state = this.store.read()
    const cleared = Object.keys(state.overrides).length + (state.scenario === null ? 0 : 1)
    this.store.write({ scenario: null, overrides: {} })
    return ok({ cleared })
  }

  /** The raw body of one response — what the generators derive shapes from. */
  getResponseBody(id: string, responseName?: string): ProjectResult<unknown> {
    const endpoint = this.load().byId.get(id)
    if (endpoint === undefined) return fail(this.unknownEndpoint(id), 'not-found')

    const name = responseName ?? endpoint.default
    const response = endpoint.responses[name]
    if (response === undefined) {
      return fail(
        `${JSON.stringify(name)} is not declared on ${id}. Available: ${Object.keys(endpoint.responses).join(', ')}`,
        'not-found',
      )
    }
    return ok(response.body)
  }

  private unknownEndpoint(id: string): string {
    const ids = this.load().endpoints.map((e) => e.id)
    const hint =
      ids.length === 0 ? 'no endpoints are loaded' : `known ids: ${ids.slice(0, 12).join(', ')}`
    return `no endpoint with id ${JSON.stringify(id)} — ${hint}`
  }
}
