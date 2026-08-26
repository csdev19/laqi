import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Navigate } from '@tanstack/react-router'
import { useState } from 'react'
import { api, ApiError, type Todo, type TodoList } from '../lib/api'
import { useSession } from '../lib/auth'

export const Route = createFileRoute('/todos')({ component: TodosRoute })

const PAGE_SIZE = 4

function TodosRoute() {
  const { session, ready } = useSession()
  if (!ready) return null
  if (!session) return <Navigate to="/login" replace />
  return <TodoList />
}

function TodoList() {
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const [title, setTitle] = useState('')

  const key = ['todos'] as const
  const todos = useQuery({ queryKey: key, queryFn: () => api.todos() })

  /**
   * Updates optimistas, y no por lujo: laqi devuelve respuestas enlatadas y
   * NO guarda nada. `POST /todos` contesta un "created" fijo. El frontend se
   * escribe como si el backend fuera real — la cache es la que sostiene el
   * estado — y el día que exista el backend, este código no cambia. Ése es
   * el punto de desarrollar contra un mock.
   */
  const patch = (change: (previous: TodoList) => TodoList) => {
    queryClient.setQueryData<TodoList>(key, (previous) => (previous ? change(previous) : previous))
  }

  const create = useMutation({
    mutationFn: (value: string) => api.createTodo(value),
    onSuccess: (created, value) => {
      // El título sale de lo que escribió el usuario, no de `created.title`:
      // el mock siempre devuelve el mismo texto enlatado, y un backend real
      // devolvería el que mandaste. Del server sólo se toma la forma.
      patch((previous) => ({
        items: [{ ...created, id: Date.now(), title: value }, ...previous.items],
      }))
      setTitle('')
      setPage(1)
    },
  })

  const toggle = useMutation({
    mutationFn: (todo: Todo) => api.updateTodo({ ...todo, done: !todo.done }),
    onMutate: (todo) => {
      patch((previous) => ({
        items: previous.items.map((item) =>
          item.id === todo.id ? { ...item, done: !item.done } : item,
        ),
      }))
    },
    onError: () => void queryClient.invalidateQueries({ queryKey: key }),
  })

  const remove = useMutation({
    mutationFn: (todo: Todo) => api.deleteTodo(todo.id),
    onMutate: (todo) => {
      patch((previous) => ({ items: previous.items.filter((item) => item.id !== todo.id) }))
    },
    onError: () => void queryClient.invalidateQueries({ queryKey: key }),
  })

  const all = todos.data?.items ?? []
  const lastPage = Math.max(1, Math.ceil(all.length / PAGE_SIZE))
  // Crear o borrar cambia cuántas páginas hay: sin esto se puede quedar
  // mirando una página que ya no existe.
  const current = Math.min(page, lastPage)
  const visible = all.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE)

  return (
    <div className="card">
      <div className="card-head">
        <h1>Todos</h1>
        {todos.data ? (
          <span className="muted">
            {all.length} total · page {current} of {lastPage}
          </span>
        ) : null}
      </div>

      <form
        className="new-todo"
        onSubmit={(event) => {
          event.preventDefault()
          if (title.trim()) create.mutate(title.trim())
        }}
      >
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="What needs doing?"
          aria-label="new todo"
        />
        <button type="submit" className="btn btn-primary" disabled={create.isPending}>
          Add
        </button>
      </form>

      {create.error ? <p className="error">{message(create.error)}</p> : null}

      {todos.isPending ? <p className="muted">Loading…</p> : null}

      {todos.error ? (
        <div className="error-block">
          <p className="error">{message(todos.error)}</p>
          <p className="muted">
            That is the <code>error</code> response of <code>GET /todos</code>. Flip it back
            in the panel and hit retry.
          </p>
          <button type="button" className="btn" onClick={() => void todos.refetch()}>
            Retry
          </button>
        </div>
      ) : null}

      {todos.data && all.length === 0 ? (
        <p className="muted">
          Nothing here yet — this is the <code>empty</code> response.
        </p>
      ) : null}

      <ul className="todos">
        {visible.map((todo) => (
          <li key={todo.id} className={todo.done ? 'is-done' : undefined}>
            <label>
              <input type="checkbox" checked={todo.done} onChange={() => toggle.mutate(todo)} />
              <span>{todo.title}</span>
            </label>
            <button
              type="button"
              className="btn btn-quiet btn-danger"
              aria-label={`delete ${todo.title}`}
              onClick={() => remove.mutate(todo)}
            >
              ×
            </button>
          </li>
        ))}
      </ul>

      {all.length > 0 ? (
        <div className="pager">
          <button
            type="button"
            className="btn"
            disabled={current <= 1}
            onClick={() => setPage(current - 1)}
          >
            ← Previous
          </button>
          <span className="muted">page {current}</span>
          <button
            type="button"
            className="btn"
            disabled={current >= lastPage}
            onClick={() => setPage(current + 1)}
          >
            Next →
          </button>
        </div>
      ) : null}

      <p className="footnote-inline">
        The mock returns the whole list and this app slices it. A real backend would
        paginate server-side — laqi ignores the query string, and asking for a page with{' '}
        <code>X-Laqi-Response</code> would outrank the panel and break the flips below.
      </p>
    </div>
  )
}

function message(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Something went wrong'
}
