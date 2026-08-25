import { HTTP_METHODS, isHttpMethod, type HttpMethod } from './method'

/** Prefijo del control panel. Ningún mock puede declarar rutas acá debajo. */
export const RESERVED_PREFIX = '/__laqi'

export type ParsedKey = { method: HttpMethod; path: string }

export type ParseKeyResult =
  | { ok: true; value: ParsedKey }
  | { ok: false; error: string }

const KEY_PATTERN = /^([A-Za-z]+)\s+(\S+)$/

export function parseEndpointKey(key: string): ParseKeyResult {
  const match = KEY_PATTERN.exec(key.trim())
  if (!match) {
    return {
      ok: false,
      error: `endpoint key must be "METHOD /path" (for example "GET /users"), got ${JSON.stringify(key)}`,
    }
  }

  const [, rawMethod = '', path = ''] = match
  const method = rawMethod.toUpperCase()

  if (!isHttpMethod(method)) {
    return {
      ok: false,
      error: `unknown HTTP method ${JSON.stringify(rawMethod)} in ${JSON.stringify(key)}. Allowed: ${HTTP_METHODS.join(', ')}`,
    }
  }

  if (!path.startsWith('/')) {
    return { ok: false, error: `path must start with "/" in ${JSON.stringify(key)}` }
  }

  if (path === RESERVED_PREFIX || path.startsWith(`${RESERVED_PREFIX}/`)) {
    return {
      ok: false,
      error: `${RESERVED_PREFIX} is reserved by the laqi control panel and cannot be mocked (${JSON.stringify(key)})`,
    }
  }

  return { ok: true, value: { method, path } }
}

export function formatEndpointId(method: HttpMethod, path: string): string {
  return `${method} ${path}`
}
