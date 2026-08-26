/**
 * Las formas que devuelve el control plane (Plan 2a).
 *
 * `LaqiEvent` se importa del subpath `@laqi/core/events` y NO del barrel:
 * `@laqi/core` re-exporta loader/state-store/writer, que importan `node:fs`,
 * y este paquete corre en el navegador. El subpath existe justamente para
 * esto — antes el tipo estaba redeclarado acá y podía driftear del real.
 *
 * Las formas que el control plane serializa a JSON (endpoints, status) sí se
 * declaran localmente: son lo que sale por HTTP, no el tipo interno.
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

export type Status = {
  watching: string
  endpointCount: number
  address: string
  errors: LoadError[]
}

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
