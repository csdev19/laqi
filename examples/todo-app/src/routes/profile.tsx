import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Navigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { api, ApiError } from '../lib/api'
import { clearSession, useSession } from '../lib/auth'

export const Route = createFileRoute('/profile')({ component: ProfileRoute })

function ProfileRoute() {
  const { session, ready } = useSession()
  if (!ready) return null
  if (!session) return <Navigate to="/login" replace />
  return <Profile />
}

function Profile() {
  const profile = useQuery({ queryKey: ['profile'], queryFn: () => api.profile() })
  const expired = profile.error instanceof ApiError && profile.error.status === 401

  // El 401 es la respuesta `unauthorized` del mock, y un frontend real cierra
  // sesión ahí. Va en un efecto, no en el render: clearSession escribe una
  // cookie, y hacer eso durante el render corre dos veces bajo StrictMode y
  // rompe la pureza que React espera.
  useEffect(() => {
    if (expired) clearSession()
  }, [expired])

  // La redirección la hace <Navigate>, que es la primitiva del router para
  // esto; el efecto de arriba ya limpió la sesión.
  if (expired) return <Navigate to="/login" replace />

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
