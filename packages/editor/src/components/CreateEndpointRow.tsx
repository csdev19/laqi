import { EXAMPLE_MODELS } from '@laqi/generate/examples'
import { useState } from 'react'
import { ModelEditor } from './ModelEditor'
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
  const [complaint, setComplaint] = useState<string | null>(null)

  /**
   * Why this form cannot be submitted yet, in the developer's words.
   *
   * Returned rather than used to disable Create: a disabled button says
   * something is wrong and never says what, and the easiest way to meet one
   * here is to type a path without its slash. The button stays clickable
   * and the click is what explains itself.
   */
  const problem = (): string | null => {
    const trimmed = path.trim()
    if (trimmed.length === 0) return 'a path is needed, starting with a slash'
    if (!trimmed.startsWith('/')) return `paths start with a slash — did you mean /${trimmed}?`
    if (mode === 'model' && model.trim().length === 0) {
      return 'paste a model, or switch back to blank'
    }
    if (mode === 'blank' && responseName.trim().length === 0) {
      return 'a response name is needed — ok, empty, error, whatever the case is called'
    }
    return null
  }

  const submit = () => {
    const wrong = problem()
    setComplaint(wrong)
    if (wrong) return
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
        onChange={(event) => {
          setPath(event.target.value)
          setComplaint(null)
        }}
      />

      {mode === 'blank' ? (
        <>
          <input
            className="create-input create-name"
            aria-label="response name"
            value={responseName}
            onChange={(event) => {
              setResponseName(event.target.value)
              setComplaint(null)
            }}
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

      <button type="button" className="btn btn-primary" onClick={submit}>
        Create
      </button>
      <button type="button" className="btn" onClick={props.onCancel}>
        Cancel
      </button>

      {mode === 'model' ? (
        <>
          <div className="create-model">
            <ModelEditor
              value={model}
              onChange={(next) => {
                setModel(next)
                setComplaint(null)
              }}
              language="typescript"
              placeholder="export interface Todo { id: number; title: string }"
              autoFocus
            />
          </div>
          {/* Under the box, not floating on it: a model is read while it is
              being pasted, and anything overlapping the code is in the way.
              Something to paste when you are trying laqi out, and something
              to check the parser against when you are not. */}
          <div className="model-examples">
            <span className="model-examples-label">examples</span>
            {EXAMPLE_MODELS.map((example) => (
              <button
                key={example.id}
                type="button"
                className="btn btn-quiet"
                title={example.blurb}
                onClick={() => setModel(example.source)}
              >
                {example.title}
              </button>
            ))}
          </div>
        </>
      ) : null}

      {/* No toasts: the failure appears where the action was taken. One at
          a time, and the one the developer just caused wins — it is about
          what is on screen right now, while the server's is about the last
          attempt. */}
      {(complaint ?? props.error) ? (
        <div className="form-error" role="alert">
          {complaint ?? props.error}
        </div>
      ) : null}
    </div>
  )
}
