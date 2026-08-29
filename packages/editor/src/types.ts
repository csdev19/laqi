/**
 * The shapes the control plane returns (Plan 2a).
 *
 * `LaqiEvent` is imported from the `@laqi/core/events` subpath and NOT from
 * the barrel: `@laqi/core` re-exports loader/state-store/writer, which
 * import `node:fs`, and this package runs in the browser. The subpath exists
 * precisely for this — the type used to be redeclared here and could drift
 * from the real one.
 *
 * The shapes the control plane serializes to JSON (endpoints, status) are
 * declared locally: they're what goes out over HTTP, not the internal type.
 */
import type { LaqiEvent } from '@laqi/core/events'
import type { LaqiState, MockResponse, Scenarios } from '@laqi/schema'

export type { LaqiEvent, LaqiState, MockResponse, Scenarios }

export type Endpoint = {
  id: string
  method: string
  path: string
  description?: string
  default: string
  responses: Record<string, MockResponse>
  file: string
  line: number
}

export type LoadError = {
  file: string
  line?: number
  col?: number
  message: string
  excerpt?: string
}

export type Share = {
  /** `null` while the tunnel is still coming up. */
  url: string | null
  token: string | null
  /** The H1 finding's guarantee, in words, to show in the band. */
  exposed: string
}

export type Status = {
  watching: string
  endpointCount: number
  address: string
  errors: LoadError[]
  /** Absent or `null` when --share is not active. */
  share?: Share | null
}

/** A log entry, which is a `request` event plus a render id. */
export type LogEntry = {
  seq: number
  time: string
  method: string
  path: string
  status: number
  resolvedName: string
  resolvedLayer: string
  ms: number
  /** The id of the endpoint that served it, or null if no route matched. */
  endpointId: string | null
}
