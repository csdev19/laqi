import { useMutation } from '@tanstack/react-query'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { api, ApiError } from '../lib/api'
import { writeSession } from '../lib/auth'

export const Route = createFileRoute('/signup')({ component: Signup })

function Signup() {
  const router = useRouter()
  const [name, setName] = useState('Ada Lovelace')
  const [email, setEmail] = useState('ada@example.com')
  const [password, setPassword] = useState('anything')

  const signUp = useMutation({
    mutationFn: () => api.signup(name, email, password),
    onSuccess: (session) => {
      writeSession(session)
      void router.navigate({ to: '/todos' })
    },
  })

  return (
    <div className="card narrow">
      <h1>Create an account</h1>
      <p className="muted">
        Flip <code>POST /auth/signup</code> to <code>taken</code> in the panel to see the 409 path.
      </p>

      <form
        onSubmit={(event) => {
          event.preventDefault()
          signUp.mutate()
        }}
      >
        <label>
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>

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

        {signUp.error ? (
          <p className="error">
            {signUp.error instanceof ApiError ? signUp.error.message : 'Something went wrong'}
          </p>
        ) : null}

        <button type="submit" className="btn btn-primary" disabled={signUp.isPending}>
          {signUp.isPending ? 'Creating…' : 'Create account'}
        </button>
      </form>

      <p className="muted">
        Already have one? <Link to="/login">Sign in</Link>.
      </p>
    </div>
  )
}
