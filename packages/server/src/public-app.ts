import { Hono } from 'hono'
import { RESERVED_PREFIX } from '@laqi/schema'
import { createMockApp, type MockRuntime } from './mock-app'

export type PublicRuntime = {
  /**
   * The ingredients of the mock app, NOT an already-built app.
   *
   * This is deliberate: `createMockApp` mounts its own `cors()`, which runs
   * after the one here and would overwrite the header. Passing the runtime
   * lets this function set the mock app's CORS with the allowed origins,
   * and makes it impossible to have the bug of serving
   * `Access-Control-Allow-Origin: *` through the tunnel — which is exactly
   * what ADR-0007 prohibits. The runtime's `cors` is ignored.
   */
  mock: Omit<MockRuntime, 'cors'>
  /**
   * The bearer token required on every request. `null` only when the
   * developer explicitly requested `--public` and has already been warned.
   */
  token: string | null
  /** Allowed origins. Never `*` in shared mode. */
  origins: string[]
  rateLimit?: { windowMs: number; max: number; globalMax: number }
  /**
   * The rate limiter's counters. Can be passed in from the outside so they
   * SURVIVE a reload: `apps/cli` rebuilds this app on every file change,
   * and with a fresh Map each time, saving a mock would hand back the full
   * quota to whoever was being rate-limited.
   */
  buckets?: Map<string, { count: number; resetAt: number }>
  /** Injectable for the tests; the real clock by default. */
  now?: () => number
}

export const DEFAULT_RATE_LIMIT = { windowMs: 60_000, max: 240, globalMax: 1200 }

/** Ceiling on live buckets. See the sweep in `consume`. */
export const MAX_BUCKETS = 10_000

/**
 * The public surface: what actually travels through the tunnel.
 *
 * The control plane is NOT mounted here. That's the structural guarantee
 * behind finding H1 — it's not that it's protected, it's that it doesn't
 * exist on this port. The explicit 404 for `/__laqi/*` further below is
 * defense in depth for the day someone mounts something by mistake.
 */
export function createPublicApp(runtime: PublicRuntime): Hono {
  const app = new Hono()

  /**
   * The CORS headers for the responses THIS app generates (401, 429, the
   * reserved-prefix 404). No `cors()` of our own here: that middleware cuts
   * off every OPTIONS request with a 204 before it reaches the mock app,
   * and `createMockApp` goes out of its way to register the OPTIONS mocks
   * ahead of its own cors() precisely so they're reachable. With a cors()
   * here, a mock `"OPTIONS /x"` that works locally would return an empty
   * 204 through the tunnel.
   */
  const corsHeaders = (origin: string | undefined): Record<string, string> =>
    origin !== undefined && runtime.origins.includes(origin)
      ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' }
      : {}
  const now = runtime.now ?? (() => Date.now())
  const limit = runtime.rateLimit ?? DEFAULT_RATE_LIMIT
  const buckets = runtime.buckets ?? new Map<string, { count: number; resetAt: number }>()

  // 404, not 403: a 403 would confirm that the control plane exists behind
  // it. Runs FIRST, before CORS and auth, so that not even a valid token
  // can reach it from the outside.
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

  // A CORS preflight gets answered HERE and never forwarded to the mock app.
  //
  // The browser doesn't send Authorization in a preflight, so it can't be
  // required to carry a token. But skipping auth for every OPTIONS leaked
  // any mock declared with the OPTIONS method: `curl -X OPTIONS` with no
  // token returned the full body through the tunnel. By answering the
  // preflight here, what reaches the mock app is only the OPTIONS requests
  // that are NOT preflights — and those do go through the token check, like
  // any other method.
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

  // The one place in the system that knows a request came over the tunnel.
  // Tagging at the emitter, not at each subscriber, is what lets the panel
  // and the terminal agree without either learning about cloudflared.
  const { onRequest } = runtime.mock
  app.route(
    '/',
    createMockApp({
      ...runtime.mock,
      cors: runtime.origins,
      onRequest:
        onRequest &&
        ((event) => onRequest(event.type === 'request' ? { ...event, via: 'public' } : event)),
    }),
  )
  return app

  function consume(key: string): { ok: true } | { ok: false; retryInMs: number } {
    const at = now()

    // Without this the Map would grow forever: the key comes from a header
    // the caller controls, nothing removes expired entries, and rotating
    // the header adds a permanent entry per request. At 1200 req/min that's
    // ~1.7M entries per day until it runs out of memory. We sweep on every
    // write, and there's a hard ceiling in case the sweep isn't enough.
    if (buckets.size >= MAX_BUCKETS) {
      for (const [bucketKey, bucket] of buckets) {
        if (at >= bucket.resetAt) buckets.delete(bucketKey)
      }
      // All of them still alive and yet above the ceiling: drop the older
      // half. Worst case, someone gets their quota back early — far
      // preferable to the process dying.
      if (buckets.size >= MAX_BUCKETS) {
        const ordered = [...buckets.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt)
        for (const [bucketKey] of ordered.slice(0, Math.floor(ordered.length / 2))) {
          if (bucketKey !== 'global') buckets.delete(bucketKey)
        }
      }
    }

    // The global limit is what actually protects: `CF-Connecting-IP` is set
    // by cloudflared, but whoever reaches the port directly could make one
    // up and rotate it to dodge their own bucket. Rotating it doesn't get
    // them out of the global one.
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
 * Constant-time comparison. A `===` leaks, through how long it takes to
 * fail, how many leading characters you got right, and bots actively scan
 * these URLs.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** A 32-hex-char token. Global `crypto`: no `node:crypto`, runs on Workers. */
export function generateToken(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}
