import { createFileRoute, Navigate } from '@tanstack/react-router'
import { useSession } from '../lib/auth'

export const Route = createFileRoute('/')({ component: Index })

function Index() {
  const { session, ready } = useSession()
  // Until mounted there's no knowing whether there's a session — deciding
  // earlier would send someone who does have one to /login.
  if (!ready) return null
  return <Navigate to={session ? '/todos' : '/login'} replace />
}
