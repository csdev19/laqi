/**
 * Las formas que devuelve el control plane (Plan 2a). Se declaran acá en vez
 * de importarse de @laqi/core a propósito: ese barrel arrastra `node:fs`
 * (loader.ts, state-store.ts) y este paquete corre en el navegador. Sólo se
 * importa @laqi/schema, que es Zod puro.
 */
import type { LaqiState, MockResponse, Scenarios } from '@laqi/schema'

export type { LaqiState, MockResponse, Scenarios }

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

export type Status = {
  watching: string
  endpointCount: number
  address: string
  errors: LoadError[]
}

/** Igual que `LaqiEvent` de @laqi/core — el SSE los manda tal cual. */
export type LaqiEvent =
  | {
      type: 'request'
      method: string
      path: string
      status: number
      resolvedName: string
      resolvedLayer: string
      ms: number
    }
  | { type: 'endpoints-changed'; endpointCount: number }
  | { type: 'error'; file: string; line?: number; col?: number; message: string; excerpt?: string }

/** Una entrada del log, que es un evento `request` más un id de render. */
export type LogEntry = {
  seq: number
  time: string
  method: string
  path: string
  status: number
  resolvedName: string
  resolvedLayer: string
  ms: number
  /** El id del endpoint que la sirvió, o null si no matcheó ninguna ruta. */
  endpointId: string | null
}
