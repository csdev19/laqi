import { EXAMPLE_BODIES, EXAMPLE_MODELS } from '@laqi/generate/examples'
import {
  parseStatusCode,
  STATUS_MAX,
  STATUS_MIN,
  type Diagnostic,
  type GenerationEvidence,
  type SchemaSnapshot,
} from '@laqi/schema'
import { useState } from 'react'
import { checkJson } from '../highlight'
import { JsonEditor, ValidityReadout } from './JsonEditor'
import { ModelEditor } from './ModelEditor'
import { StatusSelect } from './StatusSelect'

const MODES = [
  { id: 'blank', label: 'blank' },
  { id: 'model', label: 'from a model' },
  { id: 'json', label: 'from JSON' },
] as const

type Mode = (typeof MODES)[number]['id']

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']

/** What the response is called and what it returns, in either flow. */
export type ResponseChoice = { responseName: string; status: number }

export type CreateInput = {
  method: string
  path: string
  body?: unknown
  /**
   * Set only by the model flow: the schema the body was generated from, and
   * the evidence that reproduces it.
   */
  schema?: SchemaSnapshot
  generation?: GenerationEvidence
} & ResponseChoice

export function CreateEndpointRow(props: {
  error: string | null
  /**
   * A model refused because importing it would say less than the source
   * does. Shown with what would be approximated, and an explicit control to
   * import anyway — the strict default only means something if accepting it
   * is a separate act the person takes.
   */
  lossRefusal?: { message: string; diagnostics: Diagnostic[] } | null
  onCreate: (input: CreateInput) => void
  onCreateFromModel: (
    input: {
      method: string
      path: string
      model: string
      /** Which declaration to generate from; the parser chooses when absent. */
      typeName: string | undefined
      /** Set only by the accept-approximation control below. */
      allowLoss?: boolean
    } & ResponseChoice,
  ) => void
  onCancel: () => void
}) {
  const [mode, setMode] = useState<Mode>('blank')
  const [method, setMethod] = useState('GET')
  const [path, setPath] = useState('')
  const [responseName, setResponseName] = useState('ok')
  const [status, setStatus] = useState('200')
  const [model, setModel] = useState('')
  const [typeName, setTypeName] = useState('')
  const [json, setJson] = useState('')
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
    if (mode === 'json') {
      if (json.trim().length === 0) return 'paste a JSON body, or switch back to blank'
      const check = checkJson(json)
      if (!check.valid) return `that body is not JSON: ${check.message}`
    }
    if (responseName.trim().length === 0) {
      return 'a response name is needed — ok, empty, error, whatever the case is called'
    }
    // Not `Number()`: it reads `201e44` as 2.01e46, which used to reach the
    // mock file and come back as a Zod complaint about integers.
    if (parseStatusCode(status) === null) {
      return `a status is a number from ${STATUS_MIN} to ${STATUS_MAX} — ${JSON.stringify(status)} is not one`
    }
    return null
  }

  const submit = (options: { allowLoss?: boolean } = {}) => {
    const wrong = problem()
    setComplaint(wrong)
    if (wrong) return
    const response = {
      responseName: responseName.trim(),
      // Never null here: `problem()` above has already refused anything else.
      status: parseStatusCode(status) ?? 200,
    }
    if (mode === 'model') {
      props.onCreateFromModel({
        method,
        path: path.trim(),
        model: model.trim(),
        typeName: typeName.trim() || undefined,
        ...(options.allowLoss === true ? { allowLoss: true } : {}),
        ...response,
      })
      return
    }
    props.onCreate({
      method,
      path: path.trim(),
      ...response,
      ...(mode === 'json' ? { body: JSON.parse(json) as unknown } : {}),
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

      {/* In both flows: the model decides the body, not what the response
          is called or what it returns. */}
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

      {/* Three ways to say what the endpoint returns: nothing yet, a model
          to generate from, or the body itself. The path, the name and the
          status mean the same thing in all three, so they never move. */}
      <div className="mode-picker" role="group" aria-label="body source">
        {MODES.map((option) => (
          <button
            key={option.id}
            type="button"
            className={option.id === mode ? 'method-option is-selected' : 'method-option'}
            aria-pressed={option.id === mode}
            onClick={() => {
              setMode(option.id)
              setComplaint(null)
            }}
          >
            {option.label}
          </button>
        ))}
      </div>

      <button type="button" className="btn btn-primary" onClick={() => submit()}>
        Create
      </button>
      <button type="button" className="btn" onClick={props.onCancel}>
        Cancel
      </button>

      {mode === 'json' ? (
        <>
          <div className="create-model">
            <JsonEditor value={json} onChange={setJson} />
            <div className="json-readout">
              {json.trim().length > 0 ? <ValidityReadout source={json} /> : null}
            </div>
          </div>
          <div className="model-examples">
            <span className="model-examples-spacer" />
            <span className="model-examples-label">examples</span>
            {EXAMPLE_BODIES.map((example) => (
              <button
                key={example.id}
                type="button"
                className="btn btn-quiet"
                title={example.blurb}
                onClick={() => {
                  setJson(example.source)
                  setComplaint(null)
                }}
              >
                {example.title}
              </button>
            ))}
          </div>
        </>
      ) : null}

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
            {/* A model file declares several types and the parser picks one,
                which is rarely the one you meant. Empty leaves the choice
                to it; naming one settles it. */}
            <input
              className="create-input create-type"
              aria-label="type"
              placeholder="type to generate (optional)"
              value={typeName}
              onChange={(event) => setTypeName(event.target.value)}
            />
            <span className="model-examples-spacer" />
            <span className="model-examples-label">examples</span>
            {EXAMPLE_MODELS.map((example) => (
              <button
                key={example.id}
                type="button"
                className="btn btn-quiet"
                title={example.blurb}
                onClick={() => {
                  setModel(example.source)
                  // The example knows which of its declarations is the
                  // interesting one; without this, `medium` would generate
                  // from `Role` and mock the string 'viewer'.
                  setTypeName(example.typeName)
                  setComplaint(null)
                }}
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

      {/* What the source says that laqi cannot keep, listed before the
          person decides — not summarised as "some information would be
          lost", which is not something anyone can weigh. */}
      {props.lossRefusal ? (
        <div className="form-error loss-refusal" role="alert">
          <p>{props.lossRefusal.message}</p>
          <ul>
            {props.lossRefusal.diagnostics
              .filter((item) => item.kind === 'loss')
              .map((item) => (
                <li key={`${item.code}${item.pointer}`}>{item.message}</li>
              ))}
          </ul>
          <button type="button" className="btn" onClick={() => submit({ allowLoss: true })}>
            Accept approximation
          </button>
        </div>
      ) : null}
    </div>
  )
}
