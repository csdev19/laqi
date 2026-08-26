import { useEffect, useRef } from 'react'
import { EVENTS_URL } from '../api'
import type { LaqiEvent } from '../types'

const TYPES = ['request', 'endpoints-changed', 'error'] as const

/**
 * Suscribe al SSE del control plane. `onEvent` se guarda en un ref para que
 * cambiar el handler en cada render no reabra la conexión — reconectar por
 * cada tecla apretada en el filtro perdería requests del log.
 *
 * En un entorno sin EventSource (jsdom en los tests) no hace nada: el panel
 * sigue andando, sólo sin stream en vivo.
 */
export function useEvents(onEvent: (event: LaqiEvent) => void): void {
  const handler = useRef(onEvent)
  handler.current = onEvent

  useEffect(() => {
    if (typeof EventSource === 'undefined') return

    const source = new EventSource(EVENTS_URL)
    const listeners = TYPES.map((type) => {
      const listener = (message: MessageEvent<string>) => {
        try {
          handler.current(JSON.parse(message.data) as LaqiEvent)
        } catch {
          // Un frame corrupto no puede tumbar el panel entero.
        }
      }
      source.addEventListener(type, listener as EventListener)
      return [type, listener] as const
    })

    return () => {
      for (const [type, listener] of listeners) {
        source.removeEventListener(type, listener as EventListener)
      }
      source.close()
    }
  }, [])
}
