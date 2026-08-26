import { createFileRoute, Navigate } from '@tanstack/react-router'
import { useSession } from '../lib/auth'

export const Route = createFileRoute('/')({ component: Index })

function Index() {
  const { session, ready } = useSession()
  // Hasta montar no se sabe si hay sesión — decidir antes mandaría a /login
  // a alguien que sí la tiene.
  if (!ready) return null
  return <Navigate to={session ? '/todos' : '/login'} replace />
}
