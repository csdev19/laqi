import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { RESERVED_PREFIX } from '@laqi/schema'
import { createMockApp, type MockRuntime } from './mock-app'

export type PublicRuntime = {
  /**
   * Los ingredientes de la app de mocks, NO una app ya construida.
   *
   * Es a propósito: `createMockApp` monta su propio `cors()`, que corre
   * después del de acá y pisaría el header. Pasar el runtime deja que esta
   * función fije el CORS del mock app con los orígenes permitidos, y hace
   * imposible el bug de servir `Access-Control-Allow-Origin: *` por el
   * túnel — que es exactamente lo que el ADR-0007 prohíbe. `cors` del
   * runtime se ignora.
   */
  mock: Omit<MockRuntime, 'cors'>
  /**
   * El bearer token exigido a cada request. `null` sólo cuando el developer
   * pidió `--public` explícitamente y ya se le advirtió.
   */
  token: string | null
  /** Orígenes permitidos. Nunca `*` en modo compartido. */
  origins: string[]
  rateLimit?: { windowMs: number; max: number; globalMax: number }
  /** Inyectable para los tests; por defecto el reloj real. */
  now?: () => number
}

export const DEFAULT_RATE_LIMIT = { windowMs: 60_000, max: 240, globalMax: 1200 }

/**
 * La superficie pública: lo que de verdad viaja por el túnel.
 *
 * El control plane NO se monta acá. Ésa es la garantía estructural del
 * hallazgo H1 — no es que esté protegido, es que no existe en este puerto.
 * El 404 explícito de `/__laqi/*` de más abajo es defensa en profundidad
 * para el día que alguien monte algo por error.
 */
export function createPublicApp(runtime: PublicRuntime): Hono {
  const app = new Hono()
  const now = runtime.now ?? (() => Date.now())
  const limit = runtime.rateLimit ?? DEFAULT_RATE_LIMIT
  const buckets = new Map<string, { count: number; resetAt: number }>()

  // 404 y no 403: un 403 confirmaría que el control plane existe detrás.
  // Va PRIMERO, antes de CORS y del auth, para que ni siquiera un token
  // válido pueda alcanzarlo desde afuera.
  app.all(`${RESERVED_PREFIX}/*`, (c) => c.text('not found', 404))
  app.all(RESERVED_PREFIX, (c) => c.text('not found', 404))

  app.use('*', async (c, next) => {
    const verdict = consume(c.req.header('CF-Connecting-IP') ?? 'unknown')
    if (!verdict.ok) {
      return c.json(
        { error: 'laqi', message: 'too many requests' },
        429,
        { 'Retry-After': String(Math.ceil(verdict.retryInMs / 1000)) },
      )
    }
    await next()
  })

  app.use(
    '*',
    cors({
      // Nunca '*': el ADR-0007 lo prohíbe explícitamente en modo compartido.
      origin: (origin) => (runtime.origins.includes(origin) ? origin : null),
      allowHeaders: ['Content-Type', 'Authorization', 'X-Laqi-Response', 'X-Laqi-Scenario'],
      exposeHeaders: ['X-Laqi-Resolved'],
    }),
  )

  if (runtime.token !== null) {
    const expected = `Bearer ${runtime.token}`
    app.use('*', async (c, next) => {
      // El preflight nunca lleva Authorization: el navegador no lo manda.
      // Bloquearlo rompería CORS sin agregar seguridad — la request real
      // que viene después sí pasa por acá.
      if (c.req.method === 'OPTIONS') return next()

      const provided = c.req.header('Authorization') ?? ''
      if (!timingSafeEqual(provided, expected)) {
        return c.json(
          { error: 'laqi', message: 'this laqi tunnel requires a bearer token' },
          401,
          { 'WWW-Authenticate': 'Bearer' },
        )
      }
      await next()
    })
  }

  app.route('/', createMockApp({ ...runtime.mock, cors: runtime.origins }))
  return app

  function consume(key: string): { ok: true } | { ok: false; retryInMs: number } {
    const at = now()

    // El límite global es el que de verdad protege: `CF-Connecting-IP` lo
    // fija cloudflared, pero quien llegue directo al puerto podría inventarlo
    // y rotarlo para esquivar su propio bucket. Rotarlo no lo saca del global.
    for (const [bucketKey, max] of [
      [`ip:${key}`, limit.max],
      ['global', limit.globalMax],
    ] as const) {
      const bucket = buckets.get(bucketKey)

      if (bucket === undefined || at >= bucket.resetAt) {
        buckets.set(bucketKey, { count: 1, resetAt: at + limit.windowMs })
        continue
      }

      if (bucket.count >= max) return { ok: false, retryInMs: bucket.resetAt - at }
      bucket.count += 1
    }

    return { ok: true }
  }
}

/**
 * Comparación de tiempo constante. Un `===` filtra por cuánto tarda en
 * fallar cuántos caracteres iniciales acertaste, y estas URLs las escanean
 * bots activamente.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** Un token de 32 hex. `crypto` global: sin `node:crypto`, corre en Workers. */
export function generateToken(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}
