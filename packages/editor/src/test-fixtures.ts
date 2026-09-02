import type { Endpoint, LaqiState, MockResponse, Scenarios } from './types'

/** An endpoint with the three responses most rows actually carry. */
export function anEndpoint(overrides: Partial<Endpoint> = {}): Endpoint {
  const responses: Record<string, MockResponse> = {
    ok: { status: 200, body: [{ id: 1 }] },
    empty: { status: 200, body: [] },
    error: { status: 500 },
  }
  return {
    id: 'GET /todos',
    method: 'GET',
    path: '/todos',
    default: 'ok',
    responses,
    file: 'laqi/todos.json',
    line: 1,
    ...overrides,
  }
}

export function aState(overrides: Partial<LaqiState> = {}): LaqiState {
  return { scenario: null, overrides: {}, ...overrides }
}

export const noScenarios: Scenarios = {}
