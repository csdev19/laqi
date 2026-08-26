import { createFileRoute, Navigate } from '@tanstack/react-router'
import { readSession } from '../lib/auth'

export const Route = createFileRoute('/')({ component: Index })

function Index() {
  // El guard corre en el cliente: en SSR no hay cookie que leer.
  if (typeof document === 'undefined') return null
  return <Navigate to={readSession() ? '/todos' : '/login'} replace />
}
