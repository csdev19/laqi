export type LaqiEvent =
  | {
      type: 'request'
      method: string
      /** The REQUESTED path (`/users/42`), not the route pattern. */
      path: string
      status: number
      ms: number
      /**
       * The endpoint that served it, or `null` when no route matched.
       * The no-route row is the most important one in the panel's log, so
       * it has to travel over the same stream as the others.
       */
      endpointId: string | null
      /** Absent on a no-route: there was nothing to resolve. */
      resolvedName?: string
      resolvedLayer?: string
    }
  | {
      type: 'endpoints-changed'
      endpointCount: number
      /** How many files failed to load. The detail lives in /api/status. */
      errorCount?: number
    }
  | { type: 'error'; file: string; line?: number; col?: number; message: string; excerpt?: string }

/**
 * An in-memory bus, single process. No queue, no persistence: a subscriber
 * that isn't connected when something happens misses it — that's fine, it's
 * exactly what flow F3 (watch requests live) expects.
 */
export class EventBus {
  private listeners = new Set<(event: LaqiEvent) => void>()

  emit(event: LaqiEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch {
        // A broken subscriber must not take down the others or the emitter.
      }
    }
  }

  subscribe(listener: (event: LaqiEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}
