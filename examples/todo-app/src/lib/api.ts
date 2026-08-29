import { readSession } from './auth'
import type { Session, User } from './auth'

/**
 * `/api` is proxied by Vite to laqi (see vite.config.ts), so from the
 * browser everything is same-origin and there's no CORS in the way — just
 * like a real dev setup against your own backend.
 */
const BASE = '/api'

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

async function request<T>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const session = readSession()

  const headers: Record<string, string> = {}
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'
  // The production shape: the token travels on every request. laqi
  // ignores it, but the day there's a real backend this is already in place.
  if (session) headers.Authorization = `Bearer ${session.token}`

  // Deliberately NOT sending `X-Laqi-Response`. It's laqi's highest-precedence
  // layer: it beats the panel's overrides and the scenarios. If the app
  // used it for routine requests, it would be stepping on its own panel
  // flips — which is exactly what you want to be able to do while the app
  // runs. That layer is for you from curl, not for the app to use.

  const response = await fetch(`${BASE}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })

  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`.trim()
    try {
      const body = (await response.json()) as { message?: unknown }
      if (typeof body.message === 'string') message = body.message
    } catch {
      // The body wasn't JSON; the status alone already says something.
    }
    throw new ApiError(message, response.status)
  }

  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

export type Todo = { id: number; title: string; done: boolean }
export type TodoList = { items: Todo[] }
export type Profile = User & { joinedAt: string; todoCount: number }

export const api = {
  login: (email: string, password: string) =>
    request<Session>('/auth/login', { method: 'POST', body: { email, password } }),

  signup: (name: string, email: string, password: string) =>
    request<Session>('/auth/signup', { method: 'POST', body: { name, email, password } }),

  profile: () => request<Profile>('/profile'),

  /**
   * The whole list. The app paginates it client-side.
   *
   * A real backend would paginate server-side, but laqi ignores the query
   * string: `?page=2` would return exactly the same thing as `?page=1`.
   * The alternative was requesting each page with
   * `X-Laqi-Response: page-2`, and that breaks something worse — see the
   * comment in `request`.
   */
  todos: () => request<TodoList>('/todos'),

  createTodo: (title: string) =>
    request<Todo>('/todos', { method: 'POST', body: { title, done: false } }),

  updateTodo: (todo: Todo) => request<Todo>(`/todos/${todo.id}`, { method: 'PUT', body: todo }),

  deleteTodo: (id: number) => request<void>(`/todos/${id}`, { method: 'DELETE' }),
}
