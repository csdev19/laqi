import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Navigate, useRouter } from '@tanstack/react-router'
import { api, ApiError } from '../lib/api'
import { clearSession, readSession } from '../lib/auth'

export const Route = createFileRoute('/profile')({ component: ProfileRoute })

function ProfileRoute() {
  if (typeof document === 'undefined') return null
  if (!readSession()) return <Navigate to="/login" replace />
  return <Profile />
}

function Profile() {
  const router = useRouter()
  const profile = useQuery({ queryKey: ['profile'], queryFn: () => api.profile() })

  // El 401 es la respuesta `unauthorized` del mock. Un frontend real cierra
  // sesión acá, y eso es exactamente lo que conviene poder ensayar: flipeá
  // GET /profile a `unauthorized` en el panel y mirá el flujo completo.
  if (profile.error instanceof ApiError && profile.error.status === 401) {
    clearSession()
    void router.navigate({ to: '/login' })
    return null
  }

  if (profile.isPending) return <p className="muted">Loading…</p>
  if (profile.error) return <p className="error">Could not load the profile</p>

  const { name, email, joinedAt, todoCount } = profile.data

  return (
    <div className="card narrow">
      <h1>{name}</h1>
      <dl className="facts">
        <dt>Email</dt>
        <dd>{email}</dd>
        <dt>Joined</dt>
        <dd>{joinedAt}</dd>
        <dt>Todos</dt>
        <dd>{todoCount}</dd>
      </dl>
      <p className="muted">
        Flip <code>GET /profile</code> to <code>unauthorized</code> in the panel — this page
        signs you out, the way a real 401 would.
      </p>
    </div>
  )
}
