// apps/cli/src/runtime.ts
import {
  buildRouteTable,
  loadMocks,
  type LoadError,
  type LoadResult,
  type RouteTable,
} from '@laqi/core'
import type { LaqiConfig, Scenarios } from '@laqi/schema'

export type Runtime = {
  table: RouteTable
  scenarios: Scenarios
  errors: LoadError[]
  source: LoadResult['source']
}

export function buildRuntime(root: string, config: LaqiConfig): Runtime {
  const loaded = loadMocks({ root, dir: config.dir, file: config.file })
  const { table, errors: routeErrors } = buildRouteTable(loaded.endpoints)

  return {
    table,
    scenarios: loaded.scenarios,
    errors: [...loaded.errors, ...routeErrors],
    source: loaded.source,
  }
}
