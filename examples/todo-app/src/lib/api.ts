import { readSession } from './auth'
import type { Session, User } from './auth'

/**
 * `/api` lo proxea Vite hacia laqi (ver vite.config.ts), así que desde el
 * navegador todo es same-origin y no hay CORS de por medio — igual que un
 * setup de desarrollo real contra un backend propio.
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
  options: { method?: string; body?: unknown; laqiResponse?: string } = {},
): Promise<T> {
  const session = readSession()

  const headers: Record<string, string> = {}
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'
  // La forma de producción: el token viaja en cada request. laqi lo ignora,
  // pero el día que haya backend real esto ya está puesto.
  if (session) headers.Authorization = `Bearer ${session.token}`
  // La capa `header` de laqi: pedir una respuesta concreta sin cambiarle el
  // estado a nadie. Es lo que hace posible paginar contra un mock.
  if (options.laqiResponse) headers['X-Laqi-Response'] = options.laqiResponse

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
      // El cuerpo no era JSON; el status solo ya dice algo.
    }
    throw new ApiError(message, response.status)
  }

  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

export type Todo = { id: number; title: string; done: boolean }
export type TodoPage = { page: number; pageSize: number; total: number; items: Todo[] }
export type Profile = User & { joinedAt: string; todoCount: number }

export const api = {
  login: (email: string, password: string) =>
    request<Session>('/auth/login', { method: 'POST', body: { email, password } }),

  signup: (name: string, email: string, password: string) =>
    request<Session>('/auth/signup', { method: 'POST', body: { name, email, password } }),

  profile: () => request<Profile>('/profile'),

  /**
   * laqi ignora el query string, así que `?page=2` matchearía el mismo mock
   * que `?page=1`. Se pide la página por `X-Laqi-Response` — paginación real
   * contra un servidor que no tiene lógica.
   */
  todos: (page: number) => request<TodoPage>(`/todos?page=${page}`, { laqiResponse: `page-${page}` }),

  createTodo: (title: string) => request<Todo>('/todos', { method: 'POST', body: { title, done: false } }),

  updateTodo: (todo: Todo) => request<Todo>(`/todos/${todo.id}`, { method: 'PUT', body: todo }),

  deleteTodo: (id: number) => request<void>(`/todos/${id}`, { method: 'DELETE' }),
}
