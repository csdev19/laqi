import type { QueryClient } from '@tanstack/react-query'
import { createRootRouteWithContext, HeadContent, Link, Outlet, Scripts, useRouter } from '@tanstack/react-router'
import { clearSession, readSession } from '../lib/auth'
import appCss from '../styles.css?url'

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'laqi · todo demo' },
    ],
    links: [{ rel: 'stylesheet', href: appCss }],
  }),
  component: RootDocument,
})

function RootDocument() {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <Shell />
        <Scripts />
      </body>
    </html>
  )
}

function Shell() {
  const router = useRouter()
  const session = readSession()

  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="brand">
          <span className="bolt">↯</span> laqi <span className="brand-sub">todo demo</span>
        </Link>

        {session ? (
          <nav className="nav">
            <Link to="/todos" activeProps={{ className: 'is-active' }}>
              Todos
            </Link>
            <Link to="/profile" activeProps={{ className: 'is-active' }}>
              Profile
            </Link>
            <button
              type="button"
              className="btn btn-quiet"
              onClick={() => {
                clearSession()
                void router.navigate({ to: '/login' })
              }}
            >
              Sign out
            </button>
          </nav>
        ) : null}
      </header>

      <main className="main">
        <Outlet />
      </main>

      <footer className="footnote">
        Every response here comes from <strong>laqi</strong> on port 8000. Open{' '}
        <a href="http://127.0.0.1:8000/__laqi" target="_blank" rel="noreferrer">
          the panel
        </a>{' '}
        and flip a response — this app reacts without a restart.
      </footer>
    </div>
  )
}
