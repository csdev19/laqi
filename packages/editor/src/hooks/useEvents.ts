import { useEffect, useRef } from 'react'
import { EVENTS_URL } from '../api'
import type { LaqiEvent } from '../types'

const TYPES = ['request', 'endpoints-changed', 'error'] as const

/**
 * Subscribes to the control plane's SSE. `onEvent` is stored in a ref so
 * that changing the handler on every render doesn't reopen the connection —
 * reconnecting on every keystroke in the filter would lose log requests.
 *
 * In an environment without EventSource (jsdom in tests) it does nothing:
 * the panel keeps working, just without the live stream.
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
          // A corrupt frame can't take down the whole panel.
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
