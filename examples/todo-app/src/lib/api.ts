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
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const session = readSession()

  const headers: Record<string, string> = {}
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'
  // La forma de producción: el token viaja en cada request. laqi lo ignora,
  // pero el día que haya backend real esto ya está puesto.
  if (session) headers.Authorization = `Bearer ${session.token}`

  // Deliberadamente NO se manda `X-Laqi-Response`. Es la capa de mayor
  // precedencia de laqi: le gana a los overrides del panel y a los
  // escenarios. Si la app la usara para pedir cosas de rutina, se estaría
  // pisando a sí misma los flips del panel — que es justo lo que uno quiere
  // poder hacer mientras la app corre. Esa capa es para vos desde curl, no
  // para que la app la ocupe.

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
export type TodoList = { items: Todo[] }
export type Profile = User & { joinedAt: string; todoCount: number }

export const api = {
  login: (email: string, password: string) =>
    request<Session>('/auth/login', { method: 'POST', body: { email, password } }),

  signup: (name: string, email: string, password: string) =>
    request<Session>('/auth/signup', { method: 'POST', body: { name, email, password } }),

  profile: () => request<Profile>('/profile'),

  /**
   * La lista entera. La app la pagina del lado del cliente.
   *
   * Un backend real paginaría en el servidor, pero laqi ignora el query
   * string: `?page=2` devolvería exactamente lo mismo que `?page=1`. La
   * alternativa era pedir cada página con `X-Laqi-Response: page-2`, y eso
   * rompe algo peor — ver el comentario en `request`.
   */
  todos: () => request<TodoList>('/todos'),

  createTodo: (title: string) => request<Todo>('/todos', { method: 'POST', body: { title, done: false } }),

  updateTodo: (todo: Todo) => request<Todo>(`/todos/${todo.id}`, { method: 'PUT', body: todo }),

  deleteTodo: (id: number) => request<void>(`/todos/${id}`, { method: 'DELETE' }),
}
