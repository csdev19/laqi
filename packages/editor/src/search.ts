import type { Endpoint } from './types'

/**
 * The list filter: substring match over method, path, description and
 * response names. Case-insensitive, no tokenizing — it narrows what you're
 * LOOKING AT, which is a different job than the palette's.
 */
export function filterEndpoints(endpoints: Endpoint[], query: string): Endpoint[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return endpoints

  return endpoints.filter((endpoint) => haystack(endpoint).includes(needle))
}

function haystack(endpoint: Endpoint): string {
  return [
    endpoint.method,
    endpoint.path,
    endpoint.description ?? '',
    ...Object.keys(endpoint.responses),
  ]
    .join(' ')
    .toLowerCase()
}

export type PaletteResult = {
  endpoint: Endpoint
  /** The response name this row would put live. */
  response: string
}

/**
 * The palette acts without looking: multi-token, ALL tokens have to match
 * within `METHOD path response`, in any order — `orders boom` finds
 * `POST /orders → boom`. One row per endpoint×response pair, because ↵ puts
 * a specific response live, not an endpoint.
 */
export function paletteResults(endpoints: Endpoint[], query: string, limit = 40): PaletteResult[] {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const results: PaletteResult[] = []

  for (const endpoint of endpoints) {
    for (const response of Object.keys(endpoint.responses)) {
      const target = `${endpoint.method} ${endpoint.path} ${response}`.toLowerCase()
      if (tokens.every((token) => target.includes(token))) {
        results.push({ endpoint, response })
        if (results.length >= limit) return results
      }
    }
  }

  return results
}
