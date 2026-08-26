import { useEffect, useState, useSyncExternalStore } from 'react'

/**
 * El "auth" de este ejemplo es un MECANISMO DEL FRONTEND, no seguridad.
 *
 * laqi es un mock server: devuelve respuestas enlatadas y no puede verificar
 * un token — no corre lógica condicional. `POST /auth/login` responde 200 con
 * un token fijo tengas las credenciales que tengas.
 *
 * Lo que sí es real es la FORMA: se guarda una cookie, un guard de ruta
 * bloquea la app sin sesión, y cada request lleva su `Authorization: Bearer`.
 * Cuando aparezca el backend de verdad, el frontend no cambia — que es
 * exactamente para lo que sirve laqi.
 */
const COOKIE = 'laqi_demo_session'
const MAX_AGE_SECONDS = 60 * 60 * 8

export type User = { id: number; name: string; email: string }
export type Session = { token: string; user: User }

export function readSession(): Session | null {
  // En SSR no hay document.
  if (typeof document === 'undefined') return null

  const raw = rawCookie()
  if (!raw) return null

  try {
    return JSON.parse(decodeURIComponent(raw)) as Session
  } catch {
    // Cookie corrupta: se descarta en vez de romper la app.
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

/* ── El store, para que React no se entere tarde ───────────────────────── */

const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// useSyncExternalStore vuelve a llamar a getSnapshot en cada render y compara
// por identidad: devolver un objeto nuevo cada vez sería un loop infinito. Se
// cachea contra el string crudo de la cookie, que es lo que de verdad cambia.
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

/** En el servidor nunca hay sesión: es lo que hace que la hidratación cierre. */
function getServerSnapshot(): Session | null {
  return null
}

/**
 * `ready` es lo que evita el rebote: durante SSR y el primer render del
 * cliente la sesión es `null` por construcción, así que un guard que decidiera
 * ahí mandaría a /login a alguien que sí tiene sesión. Los guards esperan a
 * `ready`, que sólo se enciende después de montar.
 */
export function useSession(): { session: Session | null; ready: boolean } {
  const session = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    setReady(true)
  }, [])

  return { session, ready }
}
