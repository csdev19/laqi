import type { Endpoint, LaqiState, Scenarios } from './types'

/**
 * Las cuatro palabras de capa del modelo de estado. `header` no se origina
 * nunca en el panel (es por request), pero el log lo imprime, así que el tipo
 * tiene que incluirlo.
 */
export type Layer = 'header' | 'state' | 'scenario' | 'default'

export type LiveResponse = { name: string; layer: Layer }

/**
 * Qué respuesta está viva para un endpoint, y quién lo decidió. Es el mismo
 * orden de precedencia que `resolveResponse` de @laqi/core, menos las dos
 * ramas de header: un override por endpoint le gana al escenario activo, y
 * el `default` del archivo es siempre la baseline.
 */
export function liveResponse(input: {
  endpoint: Endpoint
  state: LaqiState
  scenarios: Scenarios
}): LiveResponse {
  const { endpoint, state, scenarios } = input

  const override = state.overrides[endpoint.id]
  if (override) return { name: override, layer: 'state' }

  if (state.scenario) {
    const fromScenario = scenarios[state.scenario]?.[endpoint.id]
    if (fromScenario) return { name: fromScenario, layer: 'scenario' }
  }

  return { name: endpoint.default, layer: 'default' }
}

/**
 * Qué escribir en el estado cuando el developer hace click en un chip.
 *
 * La regla del diseño: clickear el chip que YA es el default del archivo,
 * cuando ningún escenario cubre ese endpoint, borra el override en vez de
 * escribir uno idéntico — si no, la fila quedaría teñida de "yo cambié esto"
 * para siempre aunque sirva exactamente lo que dice el archivo.
 *
 * Cuando un escenario SÍ cubre el endpoint, elegir el default del archivo es
 * una decisión real (te estás saliendo del escenario para ese endpoint), así
 * que ahí sí se escribe el override.
 */
export function overridesAfterChipClick(input: {
  endpoint: Endpoint
  state: LaqiState
  scenarios: Scenarios
  clicked: string
}): Record<string, string> {
  const { endpoint, state, scenarios, clicked } = input
  const next = { ...state.overrides }

  const coveredByScenario = state.scenario
    ? scenarios[state.scenario]?.[endpoint.id] !== undefined
    : false

  if (clicked === endpoint.default && !coveredByScenario) {
    delete next[endpoint.id]
    return next
  }

  next[endpoint.id] = clicked
  return next
}

/** Cuántos endpoints tiene el panel fuera de su default de archivo. */
export function overriddenCount(input: {
  endpoints: Endpoint[]
  state: LaqiState
  scenarios: Scenarios
}): number {
  const { endpoints, state, scenarios } = input
  return endpoints.filter((endpoint) => liveResponse({ endpoint, state, scenarios }).layer !== 'default')
    .length
}

/** `Reset all to default` sólo se dibuja cuando hay algo que resetear. */
export function isDirty(state: LaqiState): boolean {
  return state.scenario !== null || Object.keys(state.overrides).length > 0
}
