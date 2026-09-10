import type { Diagnostic, GenerationEvidence, SchemaSnapshot, SourceRequest } from '@laqi/schema'
import type { Endpoint, LaqiState, MockResponse, Scenarios, Status } from './types'

/**
 * The panel is served mounted under /__laqi, so the API is always
 * same-origin. Absolute and not relative on purpose: a relative path would
 * resolve differently from /__laqi than from /__laqi/ and one of the two
 * would fall through to the user's mock server.
 */
const BASE = '/__laqi'

/**
 * A control plane failure, with the message the server already wrote.
 *
 * A refusal carries what the panel needs to offer the way forward: the
 * diagnostics behind a strict-loss refusal, so it can show what would be
 * approximated and offer to accept it, and the conflict reason and current
 * revision behind a refused write, so it can say what would be overwritten
 * and offer to confirm. Dropping them here would force a second request to
 * find out why the first one failed.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly diagnostics?: Diagnostic[],
    readonly conflict?: { reason: string; revision: string },
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
    throw await failure(response)
  }

  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

async function failure(response: Response): Promise<ApiError> {
  let body: { message?: unknown; diagnostics?: unknown; reason?: unknown; revision?: unknown } = {}
  try {
    body = (await response.json()) as typeof body
  } catch {
    // The body wasn't JSON. The status alone already says something.
  }

  const message =
    typeof body.message === 'string'
      ? body.message
      : `${response.status} ${response.statusText}`.trim()

  return new ApiError(
    message,
    response.status,
    Array.isArray(body.diagnostics) ? (body.diagnostics as Diagnostic[]) : undefined,
    typeof body.reason === 'string' && typeof body.revision === 'string'
      ? { reason: body.reason, revision: body.revision }
      : undefined,
  )
}

export type EndpointDefinition = {
  description?: string
  default: string
  responses: Record<string, MockResponse>
}

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
    return request<{
      code: string
      language: string
      origin: 'schema' | 'body'
      diagnostics?: Diagnostic[]
    }>(`/api/endpoints/${encodeURIComponent(id)}/types${suffix}`)
  },

  importSchema: (source: SourceRequest, options: { allowLoss?: boolean } = {}) =>
    request<{ snapshot: SchemaSnapshot; candidates: string[] }>('/api/schema/import', {
      method: 'POST',
      body: JSON.stringify({ source, ...options }),
    }),

  previewBody: (snapshot: SchemaSnapshot, options: { seed?: number; arrayLength?: number } = {}) =>
    request<{ body: unknown; evidence: GenerationEvidence; diagnostics: Diagnostic[] }>(
      '/api/schema/preview',
      { method: 'POST', body: JSON.stringify({ snapshot, ...options }) },
    ),

  regenerateResponse: (
    id: string,
    response: string,
    options: { seed?: number; arrayLength?: number } = {},
  ) =>
    request<{
      body: unknown
      evidence: GenerationEvidence
      diagnostics: Diagnostic[]
      revision: string
    }>(`${responsePath(id, response)}/regenerate`, {
      method: 'POST',
      body: JSON.stringify(options),
    }),

  applyGeneratedBody: (
    id: string,
    response: string,
    input: { body: unknown; evidence: GenerationEvidence; revision: string; confirm?: boolean },
  ) =>
    request<{ revision: string }>(`${responsePath(id, response)}/body`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),

  prepareModule: (input: { file: string; exportName: string; side: 'input' | 'output' }) =>
    request<{ token: string; resolvedPath: string; exportName: string; side: string }>(
      '/api/schema/module/prepare',
      { method: 'POST', body: JSON.stringify(input) },
    ),

  confirmModule: (input: { token: string; allowLoss?: boolean }) =>
    request<{ snapshot: SchemaSnapshot; candidates: string[] }>('/api/schema/module/confirm', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  getResponseRevision: (id: string, response: string) =>
    request<{ revision: string }>(`${responsePath(id, response)}/revision`),

  refreshSchema: (id: string, response: string, input: { revision: string; allowLoss?: boolean }) =>
    request<{ snapshot: SchemaSnapshot; revision: string }>(
      `${responsePath(id, response)}/schema/refresh`,
      { method: 'POST', body: JSON.stringify(input) },
    ),
}

function responsePath(id: string, response: string): string {
  return `/api/endpoints/${encodeURIComponent(id)}/responses/${encodeURIComponent(response)}`
}

/** The SSE URL. Exposed separately because EventSource consumes it, not fetch. */
export const EVENTS_URL = `${BASE}/events`
