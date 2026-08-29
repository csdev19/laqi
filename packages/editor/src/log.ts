import type { LaqiEvent, LogEntry } from './types'

/** Client-side cap. The log is the panel's only high-frequency render. */
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

const pad = (n: number) => String(n).padStart(2, '0')

function formatTime(at: Date): string {
  return `${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`
}

/**
 * New entries go on top and the list is cut at the cap. Always returns a new
 * array: React needs the distinct identity to repaint.
 */
export function appendLog(entries: LogEntry[], entry: LogEntry, cap = LOG_CAP): LogEntry[] {
  return [entry, ...entries].slice(0, cap)
}

/** The verbatim text of the `X-Laqi-Resolved` header, checkable against the network. */
export function resolvedText(entry: LogEntry): string {
  if (entry.endpointId === null) return 'no matching route'
  return `${entry.resolvedName} (${entry.resolvedLayer})`
}

/** The status class, which is the design's second scan dimension. */
export function statusClass(status: number): 'ok' | 'redirect' | 'client' | 'server' {
  if (status >= 500) return 'server'
  if (status >= 400) return 'client'
  if (status >= 300) return 'redirect'
  return 'ok'
}
