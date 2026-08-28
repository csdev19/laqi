import type { Endpoint, LaqiState, MockResponse, Scenarios, Status } from './types'

/**
 * El panel se sirve montado bajo /__laqi, así que la API es siempre
 * same-origin. Absoluto y no relativo a propósito: una ruta relativa se
 * resolvería distinto desde /__laqi que desde /__laqi/ y una de las dos
 * caería en el mock server del usuario.
 */
const BASE = '/__laqi'

/** Un fallo del control plane, con el mensaje que el servidor ya redactó. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${BASE}${path}`, {
      ...init,
      headers: init?.body ? { 'Content-Type': 'application/json', ...init.headers } : init?.headers,
    })
  } catch (error) {
    // El servidor se cayó o el proceso murió: el panel tiene que decirlo, no
    // quedarse con datos viejos en pantalla como si nada.
    throw new ApiError(error instanceof Error ? error.message : 'the laqi server is unreachable', 0)
  }

  if (!response.ok) {
    throw new ApiError(await errorMessage(response), response.status)
  }

  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: unknown }
    if (typeof body.message === 'string') return body.message
  } catch {
    // El cuerpo no era JSON. El status solo ya dice algo.
  }
  return `${response.status} ${response.statusText}`.trim()
}

export type EndpointDefinition = {
  description?: string
  default: string
  responses: Record<string, MockResponse>
}

export type GenerateDataInput =
  | { model: string; typeName?: string; arrayLength?: number; seed?: number }
  | { from: { endpointId: string; response: string }; arrayLength?: number; seed?: number }

export const api = {
  getEndpoints: () => request<Endpoint[]>('/api/endpoints'),
  getState: () => request<LaqiState>('/api/state'),
  getScenarios: () => request<Scenarios>('/api/scenarios'),
  getStatus: () => request<Status>('/api/status'),

  putState: (state: LaqiState) =>
    request<LaqiState>('/api/state', { method: 'PUT', body: JSON.stringify(state) }),

  createEndpoint: (input: { method: string; path: string } & EndpointDefinition) =>
    request<{ id: string }>('/api/endpoints', { method: 'POST', body: JSON.stringify(input) }),

  updateEndpoint: (id: string, definition: EndpointDefinition) =>
    request<{ ok: true }>(`/api/endpoints/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(definition),
    }),

  deleteEndpoint: (id: string) =>
    request<void>(`/api/endpoints/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  getLanguages: () => request<{ name: string; displayName: string }[]>('/api/generate/languages'),

  getTypes: (id: string, options: { response?: string; lang?: string }) => {
    const query = new URLSearchParams()
    if (options.response) query.set('response', options.response)
    if (options.lang) query.set('lang', options.lang)
    const suffix = query.size > 0 ? `?${query.toString()}` : ''
    return request<{ code: string; language: string }>(
      `/api/endpoints/${encodeURIComponent(id)}/types${suffix}`,
    )
  },

  generateData: (input: GenerateDataInput) =>
    request<{ preview: unknown; warnings: string[] }>('/api/generate/data', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
}

/** La URL del SSE. Se expone aparte porque la consume EventSource, no fetch. */
export const EVENTS_URL = `${BASE}/events`
