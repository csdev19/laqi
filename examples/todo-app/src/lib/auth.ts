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
  // En SSR no hay document. La app se hidrata y el guard corre en el cliente.
  if (typeof document === 'undefined') return null

  const raw = document.cookie
    .split('; ')
    .find((part) => part.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1)

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
}

export function clearSession(): void {
  document.cookie = `${COOKIE}=; path=/; max-age=0; SameSite=Lax`
}
