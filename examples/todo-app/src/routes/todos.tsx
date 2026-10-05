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
   * Optimistic updates, and not for the sake of it: laqi returns canned
   * responses and does NOT save anything. `POST /todos` answers with a
   * fixed "created". The frontend is written as if the backend were real
   * — the cache is what carries the state — and the day the backend
   * exists, this code doesn't change. That's the point of developing
   * against a mock.
   */
  const patch = (change: (previous: TodoList) => TodoList) => {
    queryClient.setQueryData<TodoList>(key, (previous) => (previous ? change(previous) : previous))
  }

  const create = useMutation({
    mutationFn: (value: string) => api.createTodo(value),
    onSuccess: (created, value) => {
      // The title comes from what the user typed, not from
      // `created.title`: the mock always returns the same canned text,
      // and a real backend would return what you sent. Only the shape is
      // taken from the server.
      // The id is the next one in the list, not the canned one (every
      // created todo would share it) and not a timestamp, which then shows
      // up on screen as `DELETE /todos/1791241628947`.
      patch((previous) => ({
        items: [
          {
            ...created,
            id: Math.max(0, ...previous.items.map((item) => item.id)) + 1,
            title: value,
          },
          ...previous.items,
        ],
      }))
      setTitle('')
      setPage(1)
    },
  })

  /**
   * A failed change puts back exactly what it changed, nothing more. Asking
   * the mock for the list again instead would throw away every todo this
   * session created, since laqi always answers `GET /todos` with the same
   * canned list.
   */
  const snapshot = () => queryClient.getQueryData<TodoList>(key)
  const restore = (previous: TodoList | undefined) => {
    if (previous) queryClient.setQueryData(key, previous)
  }

  const toggle = useMutation({
    mutationFn: (todo: Todo) => api.updateTodo({ ...todo, done: !todo.done }),
    onMutate: (todo) => {
      const previous = snapshot()
      patch((list) => ({
        items: list.items.map((item) =>
          item.id === todo.id ? { ...item, done: !item.done } : item,
        ),
      }))
      return previous
    },
    onError: (_error, _todo, previous) => restore(previous),
  })

  const remove = useMutation({
    mutationFn: (todo: Todo) => api.deleteTodo(todo.id),
    onMutate: (todo) => {
      const previous = snapshot()
      patch((list) => ({ items: list.items.filter((item) => item.id !== todo.id) }))
      return previous
    },
    onError: (_error, _todo, previous) => restore(previous),
  })

  // One error line for the three changes: whichever failed last.
  const failed = [create, toggle, remove].filter((mutation) => mutation.error)
  const changeError = failed.reduce<(typeof failed)[number] | undefined>(
    (latest, mutation) =>
      !latest || mutation.submittedAt > latest.submittedAt ? mutation : latest,
    undefined,
  )?.error

  const all = todos.data?.items ?? []
  const lastPage = Math.max(1, Math.ceil(all.length / PAGE_SIZE))
  // Creating or deleting changes how many pages there are: without this
  // you can end up staring at a page that no longer exists.
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

      {changeError ? <p className="error">{message(changeError)}</p> : null}

      {todos.isPending ? <p className="muted">Loading…</p> : null}

      {todos.error ? (
        <div className="error-block">
          <p className="error">{message(todos.error)}</p>
          <p className="muted">
            That is the <code>error</code> response of <code>GET /todos</code>. Flip it back in the
            panel and hit retry.
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
    </div>
  )
}

function message(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Something went wrong'
}
