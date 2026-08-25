import type { LaqiState, MockResponse, Scenarios } from '@laqi/schema'
import type { LoadedEndpoint } from './loader'

/** Las cuatro únicas palabras de capa. El panel mapea cada una a un color. */
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

  // Object.hasOwn: "toString" u otra clave heredada del prototipo no es una
  // respuesta declarada, aunque `responses[name]` devuelva algo truthy.
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
    // 1. Header explícito. No persiste nada.
    if (headerResponse) return { name: headerResponse, layer: 'header' }

    // 2. Escenario pedido por header: también capa `header`, por lo mismo.
    if (headerScenario) {
      const fromHeaderScenario = scenarios[headerScenario]?.[endpoint.id]
      if (fromHeaderScenario) return { name: fromHeaderScenario, layer: 'header' }
    }

    // 3. Override por endpoint, escrito por el panel o el MCP.
    const override = state.overrides[endpoint.id]
    if (override) return { name: override, layer: 'state' }

    // 4. Escenario activo — más general que un override, por eso va después.
    if (state.scenario) {
      const fromScenario = scenarios[state.scenario]?.[endpoint.id]
      if (fromScenario) return { name: fromScenario, layer: 'scenario' }
    }

    // 5. La baseline del archivo.
    return { name: endpoint.default, layer: 'default' }
  }
}

/** El valor exacto de `X-Laqi-Resolved`. El log del panel lo imprime verbatim. */
export function formatResolvedHeader(resolution: Resolution): string {
  return `${resolution.name} (${resolution.layer})`
}
