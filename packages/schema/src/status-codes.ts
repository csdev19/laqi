/**
 * The four classes the panel paints with. This is the ONE definition —
 * `packages/editor/src/log.ts` used to carry a second copy, which is how a
 * chip and a log row could disagree about the same number.
 */
export type StatusClass = 'ok' | 'redirect' | 'client' | 'server'

/** The five RFC classes, spelled out for the select's group headings. */
export type StatusGroup =
  | 'informational'
  | 'success'
  | 'redirection'
  | 'client error'
  | 'server error'

export type StatusCode = {
  code: number
  /** The RFC reason phrase, e.g. `Not Found`. */
  label: string
  group: StatusGroup
}

/**
 * Curated, not exhaustive. Every code a mock server plausibly returns, and
 * nothing whose only appearance is in a proxy's changelog. Free text in the
 * select covers the rest, which is why this list can afford to be short
 * enough to scan.
 */
export const STATUS_CODES: readonly StatusCode[] = [
  { code: 100, label: 'Continue', group: 'informational' },
  { code: 101, label: 'Switching Protocols', group: 'informational' },

  { code: 200, label: 'OK', group: 'success' },
  { code: 201, label: 'Created', group: 'success' },
  { code: 202, label: 'Accepted', group: 'success' },
  { code: 204, label: 'No Content', group: 'success' },
  { code: 206, label: 'Partial Content', group: 'success' },

  { code: 301, label: 'Moved Permanently', group: 'redirection' },
  { code: 302, label: 'Found', group: 'redirection' },
  { code: 303, label: 'See Other', group: 'redirection' },
  { code: 304, label: 'Not Modified', group: 'redirection' },
  { code: 307, label: 'Temporary Redirect', group: 'redirection' },
  { code: 308, label: 'Permanent Redirect', group: 'redirection' },

  { code: 400, label: 'Bad Request', group: 'client error' },
  { code: 401, label: 'Unauthorized', group: 'client error' },
  { code: 403, label: 'Forbidden', group: 'client error' },
  { code: 404, label: 'Not Found', group: 'client error' },
  { code: 405, label: 'Method Not Allowed', group: 'client error' },
  { code: 409, label: 'Conflict', group: 'client error' },
  { code: 410, label: 'Gone', group: 'client error' },
  { code: 415, label: 'Unsupported Media Type', group: 'client error' },
  { code: 422, label: 'Unprocessable Entity', group: 'client error' },
  { code: 429, label: 'Too Many Requests', group: 'client error' },

  { code: 500, label: 'Internal Server Error', group: 'server error' },
  { code: 501, label: 'Not Implemented', group: 'server error' },
  { code: 502, label: 'Bad Gateway', group: 'server error' },
  { code: 503, label: 'Service Unavailable', group: 'server error' },
  { code: 504, label: 'Gateway Timeout', group: 'server error' },
]

/** The status class, which is the panel's second scan dimension. */
export function statusClass(status: number): StatusClass {
  if (status >= 500) return 'server'
  if (status >= 400) return 'client'
  if (status >= 300) return 'redirect'
  return 'ok'
}

/**
 * Every typed token has to appear in `<code> <label>`, in any order — so
 * `404`, `not found` and `found not` all reach the same row. Same rule the
 * command palette uses; a user who has learned one search has learned both.
 */
export function filterStatusCodes(query: string): readonly StatusCode[] {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return STATUS_CODES

  return STATUS_CODES.filter((entry) => {
    const target = `${entry.code} ${entry.label}`.toLowerCase()
    return tokens.every((token) => target.includes(token))
  })
}
