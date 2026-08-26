# Todo app — a frontend built against laqi

A small TanStack Start app that consumes laqi the way a real project would:
two processes side by side, the frontend talking HTTP to a mock server that
knows nothing about it.

It covers a todo list with pagination and full CRUD, a profile page, and a
login/signup flow.

## Run it

Two terminals, from this directory.

```bash
# 1. the mock server (and its panel, on http://127.0.0.1:8000/__laqi)
bun run mock

# 2. the frontend
bun run dev
```

The frontend calls `/api/*`, which Vite proxies to laqi. Same-origin from the
browser's point of view, no CORS in the way — the same shape as a real dev
setup against your own backend.

> The `mock` script points at `../../apps/cli/dist/index.mjs`, so build the
> CLI once first (`bun run build` at the repo root). Once laqi is on npm this
> becomes `npx laqi`, and the example becomes a normal standalone project.

## The thing worth trying

Open the panel at **http://127.0.0.1:8000/__laqi** next to the app, and flip
responses while the app is running. Nothing restarts.

| Flip this | And the app… |
| --- | --- |
| `GET /todos` → `error` | shows its error state with a retry button |
| `GET /todos` → `empty` | shows the empty state |
| `GET /todos` → `one-page` | drops to three items, and the pager disappears |
| `GET /todos` → `slow` | shows the loading state, held for 2.5s |
| `GET /profile` → `unauthorized` | signs you out, the way a real 401 would |
| `POST /auth/login` → `invalid` | shows "Wrong email or password" |
| `POST /auth/login` → `slow` | shows the pending button |
| scenario `backend-caido` | breaks every todo endpoint at once |

Those failure states are the ones that are painful to reach against a real
backend, and they are one click away here.

## Three things this example is really demonstrating

**Pagination, and why it is client-side here.** A real backend paginates
server-side. laqi ignores the query string, so `?page=2` returns exactly what
`?page=1` returns — the mock hands over the whole list and this app slices it.

The tempting alternative is to ask for each page with `X-Laqi-Response: page-2`.
Do not: that header is laqi's **highest-precedence layer**, above panel
overrides and scenarios. An app that sends it on every request overrides the
panel on every request — the table above stops working entirely, which is a
much worse trade than paginating in the client. That header is for you, from
curl, when you want one response without changing anyone's state. It is not for
the app to occupy.

**Optimistic updates, because they are the honest design.** laqi returns canned
responses and stores nothing: `POST /todos` answers a fixed "created" every
time — including a fixed title. So the app is written the way it would be
against a real backend: the TanStack Query cache holds the state, the server
confirms the shape, and the title comes from what you typed rather than from
the canned body. When the real backend arrives, this code does not change. That
is the whole point of building against a mock.

**Auth as a frontend mechanism, not security.** A mock cannot verify a token;
it has no conditional logic. `POST /auth/login` returns 200 with a canned token
whatever you type. What is real is the *shape*: a cookie is stored, a route
guard gates the app, and every request carries `Authorization: Bearer …`. See
[`src/lib/auth.ts`](src/lib/auth.ts) — it says so at the top, so nobody mistakes
it for the real thing.

## Layout

```
laqi/api.json        the mocks — this is the API contract
laqi/scenarios.json  named sets of overrides (backend-caido, red-lenta, …)
src/lib/api.ts       the fetch client; attaches the bearer and the page header
src/lib/auth.ts      the cookie mechanism, and why it is not security
src/routes/          login, signup, todos, profile
```
