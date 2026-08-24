import type { LoadedEndpoint, LoadError } from './loader'

export type RouteTable = {
  /** En orden de archivo — el panel depende de que sea estable. */
  endpoints: LoadedEndpoint[]
  byId: Map<string, LoadedEndpoint>
}

export function buildRouteTable(endpoints: LoadedEndpoint[]): {
  table: RouteTable
  errors: LoadError[]
} {
  const grouped = new Map<string, LoadedEndpoint[]>()

  for (const endpoint of endpoints) {
    const existing = grouped.get(endpoint.id)
    if (existing) existing.push(endpoint)
    else grouped.set(endpoint.id, [endpoint])
  }

  const kept: LoadedEndpoint[] = []
  const errors: LoadError[] = []

  for (const [id, group] of grouped) {
    const [first] = group

    if (group.length === 1 && first) {
      kept.push(first)
      continue
    }

    // Ninguno gana: elegir uno sería adivinar, y el desarrollador no vería cuál.
    const where = group.map((e) => `${e.file}:${e.line}`).join(' and ')
    errors.push({
      file: first?.file ?? '',
      line: first?.line,
      message: `duplicate route ${id} declared in ${where}. Neither is served — remove or rename one.`,
    })
  }

  return {
    table: { endpoints: kept, byId: new Map(kept.map((e) => [e.id, e])) },
    errors,
  }
}
