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
  type EndpointDefinition,
  type HttpMethod,
  type LaqiConfig,
  type LaqiState,
  type Scenarios,
} from '@laqi/schema'

export type ProjectResult<T> = { ok: true; value: T } | { ok: false; error: string }

const ok = <T>(value: T): ProjectResult<T> => ({ ok: true, value })
const fail = <T>(error: string): ProjectResult<T> => ({ ok: false, error })

export type EndpointView = {
  id: string
  method: string
  path: string
  description?: string
  file: string
  /** Todas las respuestas declaradas, con su status. */
  responses: { name: string; status: number; delay?: number }[]
  /** El default del archivo. */
  default: string
  /** Qué se sirve ahora mismo y qué capa lo decidió. */
  live: { name: string; layer: string }
}

/**
 * Todo lo que las herramientas MCP saben hacer sobre un proyecto laqi.
 *
 * Trabaja directo sobre los archivos, no contra un servidor corriendo: el
 * mock server lee el estado en cada request y el watcher toma los cambios de
 * archivo, así que un agente puede crear mocks con laqi apagado y funcionan
 * cuando lo prendas. Cada operación recarga desde disco porque el panel, el
 * editor y el propio developer escriben los mismos archivos.
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

  /** Dónde va un endpoint nuevo: el archivo único, o laqi/api.json. */
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
    /** Sólo los endpoints que NO están en su default: el resto es ruido. */
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

    // La misma validación que corre al cargar el archivo: prefijo reservado,
    // path bien formado, segmentos alcanzables. Si no se hiciera acá, el
    // endpoint se escribiría y recién fallaría al recargar — el archivo del
    // usuario quedaría roto por una herramienta que dijo "ok".
    const id = formatEndpointId(method as HttpMethod, input.path)
    const parsed = parseEndpointKey(id)
    if (!parsed.ok) return fail(parsed.error)

    const { byId, source } = this.load()

    // Rechazar acá y no en el writer: el writer sólo ve un archivo, y en modo
    // carpeta un id que ya existe en OTRO archivo se escribiría igual — y la
    // tabla de rutas rechazaría los dos lados, matando el que ya andaba.
    const existing = byId.get(id)
    if (existing) return fail(`${JSON.stringify(id)} already exists in ${existing.file}`)

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
   * Crea muchos endpoints de una. Existe porque `import_openapi` llamaba a
   * `createEndpoint` una vez por operación, y cada llamada recarga y
   * re-parsea TODOS los archivos de mock y después reescribe el archivo
   * destino entero — O(n^2) de disco, y una recarga del watcher por cada
   * endpoint. Un spec de 150 operaciones hacía 150 de cada cosa.
   *
   * Se carga una vez, se valida todo, y se escribe una vez.
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
    // Los ids nuevos también cuentan como ocupados: dos operaciones del
    // mismo spec pueden colisionar entre sí, no sólo contra lo que ya había.
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

      const id = formatEndpointId(method as HttpMethod, input.path)
      const parsed = parseEndpointKey(id)
      if (!parsed.ok) {
        rejected.push({ id, error: parsed.error })
        continue
      }
      if (taken.has(id)) {
        rejected.push({ id, error: `${JSON.stringify(id)} already exists in ${byId.get(id)?.file ?? file}` })
        continue
      }

      taken.add(id)
      definitions.push({
        id,
        definition: { description: input.description, default: input.default, responses: input.responses },
      })
      created.push(id)
    }

    if (definitions.length > 0) {
      const result = createEndpointsInFile({ root: this.root, file, entries: definitions })
      if (!result.ok) return fail(result.error)
    }

    return ok({ created, rejected })
  }

  updateEndpoint(id: string, definition: EndpointDefinition): ProjectResult<{ id: string; file: string }> {
    const existing = this.load().byId.get(id)
    if (existing === undefined) return fail(this.unknownEndpoint(id))

    const result = updateEndpointInFile({ root: this.root, file: existing.file, id, definition })
    return result.ok ? ok({ id, file: existing.file }) : fail(result.error)
  }

  deleteEndpoint(id: string): ProjectResult<{ id: string; file: string }> {
    const existing = this.load().byId.get(id)
    if (existing === undefined) return fail(this.unknownEndpoint(id))

    const result = deleteEndpointFromFile({ root: this.root, file: existing.file, id })
    if (!result.ok) return fail(result.error)

    // Un override colgando de un endpoint borrado haría que el estado
    // nombre algo que ya no existe.
    const state = this.store.read()
    if (state.overrides[id] !== undefined) {
      const overrides = { ...state.overrides }
      delete overrides[id]
      this.store.write({ ...state, overrides })
    }

    return ok({ id, file: existing.file })
  }

  /** `response: null` borra el override y devuelve el endpoint a su default. */
  setResponse(id: string, response: string | null): ProjectResult<EndpointView> {
    const { byId, scenarios } = this.load()
    const endpoint = byId.get(id)
    if (endpoint === undefined) return fail(this.unknownEndpoint(id))

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

  /** `name: null` desactiva el escenario activo. */
  setScenario(name: string | null): ProjectResult<{ scenario: string | null; moved: EndpointView[] }> {
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

  private unknownEndpoint(id: string): string {
    const ids = this.load().endpoints.map((e) => e.id)
    const hint = ids.length === 0 ? 'no endpoints are loaded' : `known ids: ${ids.slice(0, 12).join(', ')}`
    return `no endpoint with id ${JSON.stringify(id)} — ${hint}`
  }
}
