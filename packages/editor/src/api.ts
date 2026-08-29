import type { Endpoint, LaqiState, MockResponse, Scenarios, Status } from './types'

/**
 * The panel is served mounted under /__laqi, so the API is always
 * same-origin. Absolute and not relative on purpose: a relative path would
 * resolve differently from /__laqi than from /__laqi/ and one of the two
 * would fall through to the user's mock server.
 */
const BASE = '/__laqi'

/** A control plane failure, with the message the server already wrote. */
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
    // The server went down or the process died: the panel has to say so, not
    // keep showing stale data on screen as if nothing happened.
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
    // The body wasn't JSON. The status alone already says something.
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

/** The SSE URL. Exposed separately because EventSource consumes it, not fetch. */
export const EVENTS_URL = `${BASE}/events`
