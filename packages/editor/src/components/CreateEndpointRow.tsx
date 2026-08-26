import { useState } from 'react'

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']

export type CreateInput = {
  method: string
  path: string
  responseName: string
  status: number
}

export function CreateEndpointRow(props: {
  error: string | null
  onCreate: (input: CreateInput) => void
  onCancel: () => void
}) {
  const [method, setMethod] = useState('GET')
  const [path, setPath] = useState('')
  const [responseName, setResponseName] = useState('ok')
  const [status, setStatus] = useState('200')

  const canCreate = path.trim().startsWith('/') && responseName.trim().length > 0

  const submit = () => {
    if (!canCreate) return
    props.onCreate({
      method,
      path: path.trim(),
      responseName: responseName.trim(),
      status: Number(status) || 200,
    })
  }

  return (
    <div
      className="create-row"
      onKeyDown={(event) => {
        if (event.key === 'Enter') submit()
        if (event.key === 'Escape') props.onCancel()
      }}
    >
      <div className="method-picker" role="group" aria-label="method">
        {METHODS.map((option) => (
          <button
            key={option}
            type="button"
            className={
              option === method
                ? `method-option is-selected method-${option}`
                : 'method-option'
            }
            aria-pressed={option === method}
            onClick={() => setMethod(option)}
          >
            {option}
          </button>
        ))}
      </div>

      <input
        className="create-input create-path"
        placeholder="/orders/:id"
        aria-label="path"
        autoFocus
        value={path}
        onChange={(event) => setPath(event.target.value)}
      />
      <input
        className="create-input create-name"
        aria-label="response name"
        value={responseName}
        onChange={(event) => setResponseName(event.target.value)}
      />
      <input
        className="create-input create-status"
        aria-label="status"
        inputMode="numeric"
        value={status}
        onChange={(event) => setStatus(event.target.value)}
      />

      <button type="button" className="btn btn-primary" disabled={!canCreate} onClick={submit}>
        Create
      </button>
      <button type="button" className="btn" onClick={props.onCancel}>
        Cancel
      </button>

      {/* Sin toasts: el fallo aparece donde se hizo la acción. */}
      {props.error ? <div className="form-error">{props.error}</div> : null}
    </div>
  )
}
