import { useState } from 'react'
import { StatusSelect } from './StatusSelect'

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']

export type CreateInput = {
  method: string
  path: string
  responseName: string
  status: number
  body?: unknown
}

export function CreateEndpointRow(props: {
  error: string | null
  onCreate: (input: CreateInput) => void
  onCreateFromModel: (input: { method: string; path: string; model: string }) => void
  onCancel: () => void
}) {
  const [mode, setMode] = useState<'blank' | 'model'>('blank')
  const [method, setMethod] = useState('GET')
  const [path, setPath] = useState('')
  const [responseName, setResponseName] = useState('ok')
  const [status, setStatus] = useState('200')
  const [model, setModel] = useState('')

  const pathValid = path.trim().startsWith('/')
  const canCreate =
    mode === 'blank'
      ? pathValid && responseName.trim().length > 0
      : pathValid && model.trim().length > 0

  const submit = () => {
    if (!canCreate) return
    if (mode === 'model') {
      props.onCreateFromModel({ method, path: path.trim(), model: model.trim() })
      return
    }
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
        const inTextarea = event.target instanceof HTMLTextAreaElement
        if (event.key === 'Enter' && !inTextarea) submit()
        if (event.key === 'Escape') props.onCancel()
      }}
    >
      <div className="method-picker" role="group" aria-label="method">
        {METHODS.map((option) => (
          <button
            key={option}
            type="button"
            className={
              option === method ? `method-option is-selected method-${option}` : 'method-option'
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

      {mode === 'blank' ? (
        <>
          <input
            className="create-input create-name"
            aria-label="response name"
            value={responseName}
            onChange={(event) => setResponseName(event.target.value)}
          />
          <StatusSelect label="status" value={status} onChange={setStatus} />
        </>
      ) : null}

      <button
        type="button"
        className="btn"
        onClick={() => setMode(mode === 'blank' ? 'model' : 'blank')}
      >
        {mode === 'blank' ? 'from a model' : 'blank'}
      </button>

      <button type="button" className="btn btn-primary" disabled={!canCreate} onClick={submit}>
        Create
      </button>
      <button type="button" className="btn" onClick={props.onCancel}>
        Cancel
      </button>

      {mode === 'model' ? (
        <textarea
          className="create-input create-model"
          aria-label="model"
          rows={6}
          style={{ flexBasis: '100%' }}
          placeholder="export interface Todo { id: number; title: string }"
          value={model}
          onChange={(event) => setModel(event.target.value)}
        />
      ) : null}

      {/* No toasts: the failure appears where the action was taken. */}
      {props.error ? <div className="form-error">{props.error}</div> : null}
    </div>
  )
}
