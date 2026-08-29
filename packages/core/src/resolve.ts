import type { LaqiState, MockResponse, Scenarios } from '@laqi/schema'
import type { LoadedEndpoint } from './loader'

/** The only four layer words. The panel maps each one to a color. */
export type Layer = 'header' | 'state' | 'scenario' | 'default'

export type Resolution =
  | { ok: true; name: string; layer: Layer; response: MockResponse }
  | { ok: false; name: string; layer: Layer; message: string }

export function resolveResponse(input: {
  endpoint: LoadedEndpoint
  state: LaqiState
  scenarios: Scenarios
  headerResponse?: string
  headerScenario?: string
}): Resolution {
  const { endpoint, state, scenarios, headerResponse, headerScenario } = input
  const { name, layer } = selectName()

  // Object.hasOwn: "toString" or another inherited prototype key is not a
  // declared response, even though `responses[name]` would return something
  // truthy.
  const response = Object.hasOwn(endpoint.responses, name) ? endpoint.responses[name] : undefined
  if (!response) {
    return {
      ok: false,
      name,
      layer,
      message: `response ${JSON.stringify(name)} is not declared on ${endpoint.id}. Available: ${Object.keys(endpoint.responses).join(', ')}`,
    }
  }

  return { ok: true, name, layer, response }

  function selectName(): { name: string; layer: Layer } {
    // 1. Explicit header. Doesn't persist anything.
    if (headerResponse) return { name: headerResponse, layer: 'header' }

    // 2. Scenario requested via header: also `header` layer, for the same reason.
    if (headerScenario) {
      const fromHeaderScenario = scenarios[headerScenario]?.[endpoint.id]
      if (fromHeaderScenario) return { name: fromHeaderScenario, layer: 'header' }
    }

    // 3. Per-endpoint override, written by the panel or the MCP.
    const override = state.overrides[endpoint.id]
    if (override) return { name: override, layer: 'state' }

    // 4. Active scenario — more general than an override, hence it comes after.
    if (state.scenario) {
      const fromScenario = scenarios[state.scenario]?.[endpoint.id]
      if (fromScenario) return { name: fromScenario, layer: 'scenario' }
    }

    // 5. The file's baseline.
    return { name: endpoint.default, layer: 'default' }
  }
}

/** The exact value of `X-Laqi-Resolved`. The panel's log prints it verbatim. */
export function formatResolvedHeader(resolution: Resolution): string {
  return `${resolution.name} (${resolution.layer})`
}
