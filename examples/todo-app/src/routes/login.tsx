import { useMutation } from '@tanstack/react-query'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { api, ApiError } from '../lib/api'
import { writeSession } from '../lib/auth'

export const Route = createFileRoute('/login')({ component: Login })

function Login() {
  const router = useRouter()
  const [email, setEmail] = useState('ada@example.com')
  const [password, setPassword] = useState('anything')

  const signIn = useMutation({
    mutationFn: () => api.login(email, password),
    onSuccess: (session) => {
      writeSession(session)
      void router.navigate({ to: '/todos' })
    },
  })

  return (
    <div className="card narrow">
      <h1>Sign in</h1>
      <p className="muted">
        Any credentials work — laqi answers with a canned token. Flip <code>POST /auth/login</code>{' '}
        to <code>invalid</code> in the panel to see the failure path, or to <code>slow</code> to see
        the pending state.
      </p>

      <form
        onSubmit={(event) => {
          event.preventDefault()
          signIn.mutate()
        }}
      >
        <label>
          <span>Email</span>
          <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required />
        </label>

        <label>
          <span>Password</span>
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            required
          />
        </label>

        {signIn.error ? (
          <p className="error">
            {signIn.error instanceof ApiError ? signIn.error.message : 'Something went wrong'}
          </p>
        ) : null}

        <button type="submit" className="btn btn-primary" disabled={signIn.isPending}>
          {signIn.isPending ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      <p className="muted">
        No account? <Link to="/signup">Create one</Link>.
      </p>
    </div>
  )
}
