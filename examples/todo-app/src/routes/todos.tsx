import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Navigate } from '@tanstack/react-router'
import { useState } from 'react'
import { api, ApiError, type Todo, type TodoPage } from '../lib/api'
import { readSession } from '../lib/auth'

export const Route = createFileRoute('/todos')({ component: Todos })

function Todos() {
  if (typeof document === 'undefined') return null
  if (!readSession()) return <Navigate to="/login" replace />
  return <TodoList />
}

function TodoList() {
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const [title, setTitle] = useState('')

  const key = ['todos', page] as const
  const todos = useQuery({ queryKey: key, queryFn: () => api.todos(page) })

  /**
   * Updates optimistas, y no por lujo: laqi devuelve respuestas enlatadas y
   * NO guarda nada. `POST /todos` contesta un "created" fijo. El frontend se
   * escribe como si el backend fuera real — la cache es la que sostiene el
   * estado — y el día que exista el backend, este código no cambia. Ése es
   * el punto de desarrollar contra un mock.
   */
  const patchPage = (change: (previous: TodoPage) => TodoPage) => {
    queryClient.setQueryData<TodoPage>(key, (previous) => (previous ? change(previous) : previous))
  }

  const create = useMutation({
    mutationFn: (value: string) => api.createTodo(value),
    onSuccess: (created) => {
      // laqi siempre devuelve el mismo id; se le da uno local para que React
      // no vea claves repetidas al crear varios.
      patchPage((previous) => ({
        ...previous,
        total: previous.total + 1,
        items: [{ ...created, id: Date.now() }, ...previous.items],
      }))
      setTitle('')
    },
  })

  const toggle = useMutation({
    mutationFn: (todo: Todo) => api.updateTodo({ ...todo, done: !todo.done }),
    onMutate: (todo) => {
      patchPage((previous) => ({
        ...previous,
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
      patchPage((previous) => ({
        ...previous,
        total: previous.total - 1,
        items: previous.items.filter((item) => item.id !== todo.id),
      }))
    },
    onError: () => void queryClient.invalidateQueries({ queryKey: key }),
  })

  const data = todos.data
  const lastPage = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1

  return (
    <div className="card">
      <div className="card-head">
        <h1>Todos</h1>
        {data ? (
          <span className="muted">
            {data.total} total · page {data.page} of {lastPage}
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

      {data && data.items.length === 0 ? (
        <p className="muted">Nothing here yet — this is the <code>empty</code> response.</p>
      ) : null}

      <ul className="todos">
        {data?.items.map((todo) => (
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

      <div className="pager">
        <button
          type="button"
          className="btn"
          disabled={page <= 1 || todos.isFetching}
          onClick={() => setPage((current) => current - 1)}
        >
          ← Previous
        </button>
        <span className="muted">page {page}</span>
        <button
          type="button"
          className="btn"
          disabled={page >= lastPage || todos.isFetching}
          onClick={() => setPage((current) => current + 1)}
        >
          Next →
        </button>
      </div>

      <p className="footnote-inline">
        laqi ignores the query string, so the page is requested with{' '}
        <code>X-Laqi-Response: page-{page}</code> — real pagination against a server with
        no logic.
      </p>
    </div>
  )
}

function message(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Something went wrong'
}
