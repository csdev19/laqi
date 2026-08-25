import type { LaqiEvent, LogEntry } from './types'

/** Cap del cliente. El log es el único render de alta frecuencia del panel. */
export const LOG_CAP = 200

type RequestEvent = Extract<LaqiEvent, { type: 'request' }>

export function toLogEntry(event: RequestEvent, seq: number, at: Date): LogEntry {
  return {
    seq,
    time: formatTime(at),
    method: event.method,
    path: event.path,
    status: event.status,
    resolvedName: event.resolvedName ?? '',
    resolvedLayer: event.resolvedLayer ?? '',
    ms: event.ms,
    endpointId: event.endpointId,
  }
}

function formatTime(at: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`
}

/**
 * Las entradas nuevas van arriba y la lista se corta al cap. Devuelve un
 * array nuevo siempre: React necesita la identidad distinta para repintar.
 */
export function appendLog(entries: LogEntry[], entry: LogEntry, cap = LOG_CAP): LogEntry[] {
  return [entry, ...entries].slice(0, cap)
}

/** El texto verbatim del header `X-Laqi-Resolved`, verificable contra la red. */
export function resolvedText(entry: LogEntry): string {
  if (entry.endpointId === null) return 'no matching route'
  return `${entry.resolvedName} (${entry.resolvedLayer})`
}

/** La clase de status, que es la segunda dimensión de escaneo del diseño. */
export function statusClass(status: number): 'ok' | 'redirect' | 'client' | 'server' {
  if (status >= 500) return 'server'
  if (status >= 400) return 'client'
  if (status >= 300) return 'redirect'
  return 'ok'
}
