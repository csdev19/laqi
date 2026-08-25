import type { Endpoint } from './types'

/**
 * El filtro de la lista: match de substring sobre método, path, descripción
 * y nombres de respuesta. Case-insensitive, sin tokenizar — narrows lo que
 * MIRÁS, que es un trabajo distinto al de la paleta.
 */
export function filterEndpoints(endpoints: Endpoint[], query: string): Endpoint[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return endpoints

  return endpoints.filter((endpoint) => haystack(endpoint).includes(needle))
}

function haystack(endpoint: Endpoint): string {
  return [endpoint.method, endpoint.path, endpoint.description ?? '', ...Object.keys(endpoint.responses)]
    .join(' ')
    .toLowerCase()
}

export type PaletteResult = {
  endpoint: Endpoint
  /** El nombre de respuesta que esta fila pondría en vivo. */
  response: string
}

/**
 * La paleta actúa sin mirar: multi-token, TODOS los tokens tienen que
 * matchear en `METHOD path response`, en cualquier orden — `orders boom`
 * encuentra `POST /orders → boom`. Una fila por par endpoint×respuesta,
 * porque el ↵ pone una respuesta concreta en vivo, no un endpoint.
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
