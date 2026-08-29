import { useEffect, useState, useSyncExternalStore } from 'react'

/**
 * This example's "auth" is a FRONTEND MECHANISM, not security.
 *
 * laqi is a mock server: it returns canned responses and can't verify a
 * token — it runs no conditional logic. `POST /auth/login` responds 200
 * with a fixed token no matter what credentials you send.
 *
 * What IS real is the SHAPE: a cookie is stored, a route guard blocks the
 * app without a session, and every request carries its `Authorization:
 * Bearer`. Once the real backend shows up, the frontend doesn't change —
 * which is exactly what laqi is for.
 */
const COOKIE = 'laqi_demo_session'
const MAX_AGE_SECONDS = 60 * 60 * 8

export type User = { id: number; name: string; email: string }
export type Session = { token: string; user: User }

export function readSession(): Session | null {
  // There's no document in SSR.
  if (typeof document === 'undefined') return null

  const raw = rawCookie()
  if (!raw) return null

  try {
    return JSON.parse(decodeURIComponent(raw)) as Session
  } catch {
    // Corrupt cookie: discard it instead of breaking the app.
    return null
  }
}

export function writeSession(session: Session): void {
  const value = encodeURIComponent(JSON.stringify(session))
  document.cookie = `${COOKIE}=${value}; path=/; max-age=${MAX_AGE_SECONDS}; SameSite=Lax`
  emit()
}

export function clearSession(): void {
  document.cookie = `${COOKIE}=; path=/; max-age=0; SameSite=Lax`
  emit()
}

function rawCookie(): string | undefined {
  return document.cookie
    .split('; ')
    .find((part) => part.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1)
}

/* ── The store, so React doesn't find out late ──────────────────────────── */

const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// useSyncExternalStore calls getSnapshot again on every render and compares
// by identity: returning a new object every time would be an infinite
// loop. It's cached against the cookie's raw string, which is what
// actually changes.
let cachedRaw: string | undefined
let cachedSession: Session | null = null

function getSnapshot(): Session | null {
  const raw = rawCookie()
  if (raw !== cachedRaw) {
    cachedRaw = raw
    cachedSession = readSession()
  }
  return cachedSession
}

/** On the server there is never a session: that's what makes hydration line up. */
function getServerSnapshot(): Session | null {
  return null
}

/**
 * `ready` is what avoids the bounce: during SSR and the client's first
 * render the session is `null` by construction, so a guard that decided
 * right then would send someone who does have a session to /login. Guards
 * wait for `ready`, which only turns on after mounting.
 */
export function useSession(): { session: Session | null; ready: boolean } {
  const session = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    setReady(true)
  }, [])

  return { session, ready }
}
