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
