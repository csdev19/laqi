import type { Endpoint, LaqiState, Scenarios } from './types'

/**
 * The four layer names of the state model. `header` never originates in the
 * panel (it's per-request), but the log prints it, so the type has to
 * include it.
 */
export type Layer = 'header' | 'state' | 'scenario' | 'default'

export type LiveResponse = { name: string; layer: Layer }

/**
 * Which response is live for an endpoint, and who decided it. It's the same
 * precedence order as `resolveResponse` from @laqi/core, minus the two
 * header branches: a per-endpoint override beats the active scenario, and
 * the file's `default` is always the baseline.
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
 * What to write to state when the developer clicks a chip.
 *
 * The design rule: clicking the chip that's ALREADY the file's default, when
 * no scenario covers that endpoint, removes the override instead of writing
 * an identical one — otherwise the row would stay tinted "I changed this"
 * forever even though it serves exactly what the file says.
 *
 * When a scenario DOES cover the endpoint, choosing the file's default is a
 * real decision (you're opting out of the scenario for that endpoint), so
 * the override does get written in that case.
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

/** How many endpoints the panel has outside their file default. */
export function overriddenCount(input: {
  endpoints: Endpoint[]
  state: LaqiState
  scenarios: Scenarios
}): number {
  const { endpoints, state, scenarios } = input
  return endpoints.filter(
    (endpoint) => liveResponse({ endpoint, state, scenarios }).layer !== 'default',
  ).length
}

/** `Reset all to default` is only drawn when there's something to reset. */
export function isDirty(state: LaqiState): boolean {
  return state.scenario !== null || Object.keys(state.overrides).length > 0
}
