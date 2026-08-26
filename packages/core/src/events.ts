export type LaqiEvent =
  | {
      type: 'request'
      method: string
      /** El path PEDIDO (`/users/42`), no el patrón de la ruta. */
      path: string
      status: number
      ms: number
      /**
       * El endpoint que la sirvió, o `null` cuando no matcheó ninguna ruta.
       * La fila no-route es la más importante del log del panel, así que
       * tiene que viajar por el mismo stream que las demás.
       */
      endpointId: string | null
      /** Ausentes en una no-route: no hubo nada que resolver. */
      resolvedName?: string
      resolvedLayer?: string
    }
  | {
      type: 'endpoints-changed'
      endpointCount: number
      /** Cuántos archivos no cargaron. El detalle está en /api/status. */
      errorCount?: number
    }
  | { type: 'error'; file: string; line?: number; col?: number; message: string; excerpt?: string }

/**
 * Un bus en memoria, un solo proceso. No hay cola ni persistencia: un
 * suscriptor que no está conectado cuando algo pasa, se lo pierde — eso está
 * bien, es exactamente lo que el flujo F3 (mirar requests en vivo) espera.
 */
export class EventBus {
  private listeners = new Set<(event: LaqiEvent) => void>()

  emit(event: LaqiEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch {
        // Un suscriptor roto no debe tumbar a los demás ni al emisor.
      }
    }
  }

  subscribe(listener: (event: LaqiEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}
