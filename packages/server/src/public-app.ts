import { Hono } from 'hono'
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
  /**
   * Los contadores del rate limiter. Se puede pasar desde afuera para que
   * SOBREVIVAN a un reload: `apps/cli` reconstruye esta app en cada cambio
   * de archivo, y con un Map nuevo cada vez, guardar un mock le devolvía la
   * cuota entera a quien estuviera siendo limitado.
   */
  buckets?: Map<string, { count: number; resetAt: number }>
  /** Inyectable para los tests; por defecto el reloj real. */
  now?: () => number
}

export const DEFAULT_RATE_LIMIT = { windowMs: 60_000, max: 240, globalMax: 1200 }

/** Techo de buckets vivos. Ver el barrido en `consume`. */
export const MAX_BUCKETS = 10_000

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

  /**
   * Los headers de CORS para las respuestas que genera ESTA app (401, 429,
   * el 404 del prefijo reservado). Nada de un `cors()` propio acá: ese
   * middleware corta toda request OPTIONS con un 204 antes de llegar al
   * mock app, y `createMockApp` se toma el trabajo de registrar los mocks
   * OPTIONS antes de su propio cors() justo para que sean alcanzables. Con
   * un cors() acá, un mock `"OPTIONS /x"` que anda en local devolvía un 204
   * vacío por el túnel.
   */
  const corsHeaders = (origin: string | undefined): Record<string, string> =>
    origin !== undefined && runtime.origins.includes(origin)
      ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' }
      : {}
  const now = runtime.now ?? (() => Date.now())
  const limit = runtime.rateLimit ?? DEFAULT_RATE_LIMIT
  const buckets = runtime.buckets ?? new Map<string, { count: number; resetAt: number }>()

  // 404 y no 403: un 403 confirmaría que el control plane existe detrás.
  // Va PRIMERO, antes de CORS y del auth, para que ni siquiera un token
  // válido pueda alcanzarlo desde afuera.
  app.all(`${RESERVED_PREFIX}/*`, (c) => c.text('not found', 404))
  app.all(RESERVED_PREFIX, (c) => c.text('not found', 404))

  app.use('*', async (c, next) => {
    const verdict = consume(c.req.header('CF-Connecting-IP') ?? 'unknown')
    if (!verdict.ok) {
      return c.json({ error: 'laqi', message: 'too many requests' }, 429, {
        'Retry-After': String(Math.ceil(verdict.retryInMs / 1000)),
        ...corsHeaders(c.req.header('Origin')),
      })
    }
    await next()
  })

  // Un preflight de CORS se contesta ACÁ y no se reenvía nunca al mock app.
  //
  // El navegador no manda Authorization en un preflight, así que no se le
  // puede exigir token. Pero saltear el auth para todo OPTIONS filtraba
  // cualquier mock declarado con método OPTIONS: `curl -X OPTIONS` sin
  // token devolvía el cuerpo completo por el túnel. Contestando el
  // preflight acá, lo que pasa al mock app es sólo OPTIONS que NO son
  // preflight — y ésos sí pasan por el token, como cualquier otro método.
  app.use('*', async (c, next) => {
    if (c.req.method !== 'OPTIONS' || c.req.header('Access-Control-Request-Method') === undefined) {
      return next()
    }

    const origin = c.req.header('Origin')
    if (origin === undefined || !runtime.origins.includes(origin)) return c.body(null, 204)

    return c.body(null, 204, {
      ...corsHeaders(origin),
      'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS',
      'Access-Control-Allow-Headers':
        'Content-Type, Authorization, X-Laqi-Response, X-Laqi-Scenario',
      'Access-Control-Max-Age': '600',
    })
  })

  if (runtime.token !== null) {
    const expected = `Bearer ${runtime.token}`
    app.use('*', async (c, next) => {
      const provided = c.req.header('Authorization') ?? ''
      if (!timingSafeEqual(provided, expected)) {
        return c.json({ error: 'laqi', message: 'this laqi tunnel requires a bearer token' }, 401, {
          'WWW-Authenticate': 'Bearer',
          ...corsHeaders(c.req.header('Origin')),
        })
      }
      await next()
    })
  }

  app.route('/', createMockApp({ ...runtime.mock, cors: runtime.origins }))
  return app

  function consume(key: string): { ok: true } | { ok: false; retryInMs: number } {
    const at = now()

    // Sin esto el Map crece para siempre: la clave sale de un header que
    // el que llama controla, nada borra las entradas vencidas, y rotar el
    // header agrega una entrada permanente por request. A 1200 req/min eso
    // es ~1.7M entradas por día hasta quedarse sin memoria. Se barre en
    // cada escritura, y hay un techo duro por si el barrido no alcanza.
    if (buckets.size >= MAX_BUCKETS) {
      for (const [bucketKey, bucket] of buckets) {
        if (at >= bucket.resetAt) buckets.delete(bucketKey)
      }
      // Todas vivas y aun así por encima del techo: se tira la mitad más
      // vieja. Peor caso, alguien recupera cuota antes de tiempo — muy
      // preferible a que el proceso muera.
      if (buckets.size >= MAX_BUCKETS) {
        const ordered = [...buckets.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt)
        for (const [bucketKey] of ordered.slice(0, Math.floor(ordered.length / 2))) {
          if (bucketKey !== 'global') buckets.delete(bucketKey)
        }
      }
    }

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
