import { useEffect, useMemo, useRef, useState } from 'react'
import { api, type EndpointDefinition } from '../api'
import { checkJson } from '../highlight'
import { statusClass } from '../log'
import { liveResponse } from '../resolve'
import type { Endpoint, LaqiState, MockResponse, Scenarios } from '../types'
import { Dialog } from './Dialog'
import { JsonEditor, ValidityReadout } from './JsonEditor'
import { WarningBand } from './WarningBand'

type Draft = {
  description: string
  default: string
  responses: Record<string, MockResponse>
  /** El cuerpo se edita como texto: JSON a medio escribir no es parseable. */
  bodies: Record<string, string>
}

function toDraft(endpoint: Endpoint): Draft {
  const bodies: Record<string, string> = {}
  for (const [name, response] of Object.entries(endpoint.responses)) {
    bodies[name] = response.body === undefined ? '' : JSON.stringify(response.body, null, 2)
  }
  return {
    description: endpoint.description ?? '',
    default: endpoint.default,
    responses: structuredClone(endpoint.responses),
    bodies,
  }
}

export function EndpointDetail(props: {
  endpoint: Endpoint
  state: LaqiState
  scenarios: Scenarios
  address: string
  saveError: string | null
  onBack: () => void
  onFlip: (endpoint: Endpoint, response: string) => void
  onSave: (id: string, definition: EndpointDefinition) => void
  onDelete: (id: string) => void
}) {
  const { endpoint, state, scenarios } = props
  const [draft, setDraft] = useState<Draft>(() => toDraft(endpoint))
  const [selected, setSelected] = useState<string>(endpoint.default)
  const [typesLang, setTypesLang] = useState('typescript')
  const [languages, setLanguages] = useState<{ name: string; displayName: string }[]>([
    { name: 'typescript', displayName: 'TypeScript' },
  ])
  const [actionError, setActionError] = useState<string | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const [renameValue, setRenameValue] = useState<string | null>(null)

  // This bumps every time the fingerprint changes (see below). Regenerate
  // captures the current value when it starts and compares it on resolve:
  // if they no longer match, a reload won in the meantime and the late
  // response is discarded rather than overwriting the fresh draft. It does
  // not depend on the component unmounting — a reload rerenders the same
  // instance.
  const epochRef = useRef(0)

  // Without this list the panel keeps working with the TypeScript default:
  // not worth blocking the screen on a fetch that can fail.
  useEffect(() => {
    api
      .getLanguages()
      .then(setLanguages)
      .catch(() => {})
  }, [])

  // El watcher puede recargar el endpoint bajo los pies (alguien editó el
  // archivo a mano). Rearmar el draft desde la definición nueva.
  //
  // La dependencia es el CONTENIDO, no la identidad del objeto: `refresh()`
  // devuelve objetos nuevos en cada llamada aunque nada haya cambiado, y
  // cualquier recarga ajena (el watcher, un agente escribiendo por MCP,
  // otra pestaña guardando) borraba lo que estabas tipeando.
  const fingerprint = JSON.stringify([
    endpoint.id,
    endpoint.description,
    endpoint.default,
    endpoint.responses,
  ])
  useEffect(() => {
    epochRef.current += 1
    setDraft(toDraft(endpoint))
    setSelected((current) => (current in endpoint.responses ? current : endpoint.default))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `endpoint` a propósito no está: ver arriba
  }, [fingerprint])

  const live = liveResponse({ endpoint, state, scenarios })
  const names = Object.keys(draft.responses)
  const current = draft.responses[selected]
  const bodySource = draft.bodies[selected] ?? ''

  const dirty = useMemo(() => !sameDefinition(draft, endpoint), [draft, endpoint])

  const patch = (name: string, change: Partial<MockResponse>) => {
    setDraft((previous) => ({
      ...previous,
      responses: { ...previous.responses, [name]: { ...previous.responses[name]!, ...change } },
    }))
  }

  const save = () => {
    const responses: Record<string, MockResponse> = {}
    for (const [name, response] of Object.entries(draft.responses)) {
      const source = draft.bodies[name] ?? ''
      const trimmed = source.trim()
      responses[name] =
        trimmed === '' ? omitBody(response) : { ...response, body: JSON.parse(trimmed) as unknown }
    }
    props.onSave(endpoint.id, {
      description: draft.description.trim() || undefined,
      default: draft.default,
      responses,
    })
  }

  const everyBodyValid = names.every((name) => {
    const source = (draft.bodies[name] ?? '').trim()
    return source === '' || checkJson(source).valid
  })

  return (
    <div className="detail">
      <div className="detail-header">
        <button type="button" className="btn" onClick={props.onBack}>
          ← Endpoints (esc)
        </button>
        <span className={`row-method method-${endpoint.method}`}>{endpoint.method}</span>
        <span className="detail-path">{endpoint.path}</span>
        {endpoint.description ? (
          <span className="detail-description">{endpoint.description}</span>
        ) : null}
        <span className={`live-pill layer-${live.layer}`}>
          {live.name} · {live.layer}
        </span>

        <div className="header-actions">
          <button
            type="button"
            className="btn btn-primary"
            disabled={!dirty || !everyBodyValid}
            onClick={save}
          >
            {dirty ? 'Save to file' : 'Saved'}
          </button>
          <button
            type="button"
            className="btn btn-danger"
            onClick={() => props.onDelete(endpoint.id)}
          >
            Delete endpoint
          </button>
        </div>
      </div>

      {props.saveError || actionError ? (
        <div className="band band-error">{props.saveError ?? actionError}</div>
      ) : null}
      <WarningBand warnings={warnings} onDismiss={() => setWarnings([])} />

      <div className="detail-columns">
        <div className="detail-responses">
          {names.map((name) => (
            <button
              key={name}
              type="button"
              className={name === selected ? 'response-item is-selected' : 'response-item'}
              onClick={() => setSelected(name)}
            >
              <span
                className={
                  name === live.name ? `response-marker layer-${live.layer}` : 'response-marker'
                }
                aria-hidden="true"
              />
              <span className="response-name">{name}</span>
              <span className={`chip-status status-${statusClass(draft.responses[name]!.status)}`}>
                {draft.responses[name]!.status}
              </span>
            </button>
          ))}

          <button
            type="button"
            className="add-response"
            onClick={() => {
              const name = uniqueName(names)
              setDraft((previous) => ({
                ...previous,
                responses: { ...previous.responses, [name]: { status: 200 } },
                bodies: { ...previous.bodies, [name]: '{}' },
              }))
              setSelected(name)
            }}
          >
            + Add response
          </button>
        </div>

        <div className="detail-body">
          <div className="editor-toolbar">
            <ValidityReadout source={bodySource || 'null'} />
            <div className="header-actions">
              {live.name === selected ? (
                // Currently being served is a *state*, not a disabled
                // action — reuse the live-pill/live-dot idiom the panel
                // already has instead of a greyed-out button that still
                // looks (uselessly) clickable.
                <span className={`live-pill layer-${live.layer}`}>
                  <span className="live-dot" aria-hidden="true" /> Serving
                </span>
              ) : (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => props.onFlip(endpoint, selected)}
                >
                  Serve this
                </button>
              )}
              <button
                type="button"
                className="btn"
                onClick={() => {
                  const epoch = epochRef.current
                  setActionError(null)
                  setWarnings([])
                  void api
                    .generateData({ from: { endpointId: endpoint.id, response: selected } })
                    .then(({ preview, warnings: generationWarnings }) => {
                      // Discard if the endpoint reloaded while the call was
                      // in flight: the reload already rebuilt the draft and
                      // this response no longer belongs to it.
                      if (epochRef.current !== epoch) return
                      setDraft((previous) => ({
                        ...previous,
                        bodies: {
                          ...previous.bodies,
                          [selected]: JSON.stringify(preview, null, 2),
                        },
                      }))
                      setWarnings(generationWarnings)
                    })
                    .catch((error: unknown) => {
                      if (epochRef.current !== epoch) return
                      setActionError(error instanceof Error ? error.message : String(error))
                    })
                }}
              >
                Regenerate
              </button>
              <button type="button" className="btn" onClick={() => setRenameValue(selected)}>
                Rename
              </button>
              <button
                type="button"
                className="btn btn-danger"
                disabled={names.length <= 1}
                onClick={() => {
                  setDraft((previous) => deleteResponse(previous, selected))
                  setSelected(names.find((name) => name !== selected) ?? '')
                }}
              >
                Delete
              </button>
            </div>
          </div>

          <JsonEditor
            value={bodySource}
            onChange={(value) =>
              setDraft((previous) => ({
                ...previous,
                bodies: { ...previous.bodies, [selected]: value },
              }))
            }
          />
        </div>

        <div className="detail-meta">
          {current ? (
            <>
              <div className="meta-field">
                <label className="micro" htmlFor="meta-status">
                  status
                </label>
                <input
                  id="meta-status"
                  className="meta-input"
                  inputMode="numeric"
                  value={String(current.status)}
                  onChange={(event) =>
                    patch(selected, { status: Number(event.target.value) || current.status })
                  }
                />
              </div>

              <div className="meta-field">
                <label className="micro" htmlFor="meta-delay">
                  delay (ms)
                </label>
                <input
                  id="meta-delay"
                  className="meta-input"
                  inputMode="numeric"
                  value={String(current.delay ?? 0)}
                  onChange={(event) => {
                    const delay = Number(event.target.value) || 0
                    patch(selected, delay === 0 ? { delay: undefined } : { delay })
                  }}
                />
              </div>

              <div className="meta-field">
                <label className="micro" htmlFor="meta-description">
                  endpoint description
                </label>
                <input
                  id="meta-description"
                  className="meta-input"
                  value={draft.description}
                  onChange={(event) =>
                    setDraft((previous) => ({ ...previous, description: event.target.value }))
                  }
                />
              </div>

              <div className="meta-field">
                <span className="micro">curl</span>
                {/* Enseña la capa header mostrándola, que es como se prueba
                    una respuesta sin tocar la app. */}
                <pre className="meta-curl">{curlFor(endpoint, selected, props.address)}</pre>
              </div>

              <div className="meta-field">
                <span className="micro">types</span>
                <div className="detail-actions">
                  <select
                    className="meta-input"
                    aria-label="types language"
                    value={typesLang}
                    onChange={(event) => setTypesLang(event.target.value)}
                  >
                    {languages.map((language) => (
                      <option key={language.name} value={language.name}>
                        {language.displayName}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      setActionError(null)
                      void api
                        .getTypes(endpoint.id, { response: selected, lang: typesLang })
                        .then(({ code }) => navigator.clipboard?.writeText(code))
                        .catch((error: unknown) =>
                          setActionError(error instanceof Error ? error.message : String(error)),
                        )
                    }}
                  >
                    Copy types
                  </button>
                </div>
              </div>

              <div className="meta-field">
                <span className="micro">declared in</span>
                <div className="meta-file">
                  {endpoint.file}:{endpoint.line}
                </div>
              </div>
            </>
          ) : null}
        </div>
      </div>

      {renameValue !== null ? (
        <Dialog
          title="Rename response"
          description={`Renaming "${selected}"`}
          confirmLabel="Rename"
          confirmDisabled={
            renameValue.trim() === '' ||
            renameValue.trim() === selected ||
            renameValue.trim() in draft.responses
          }
          onCancel={() => setRenameValue(null)}
          onConfirm={() => {
            const next = renameValue.trim()
            if (next === '' || next === selected || next in draft.responses) return
            setDraft((previous) => renameResponse(previous, selected, next))
            setSelected(next)
            setRenameValue(null)
          }}
        >
          <label className="micro" htmlFor="rename-input">
            new name
          </label>
          <input
            id="rename-input"
            className="dialog-input"
            value={renameValue}
            onChange={(event) => setRenameValue(event.target.value)}
          />
        </Dialog>
      ) : null}
    </div>
  )
}

function curlFor(endpoint: Endpoint, response: string, address: string): string {
  const method = endpoint.method === 'GET' ? '' : `-X ${endpoint.method} `
  return `curl ${method}-H 'X-Laqi-Response: ${response}' http://${address}${endpoint.path}`
}

function uniqueName(existing: string[]): string {
  let index = 1
  let name = 'new'
  while (existing.includes(name)) name = `new-${++index}`
  return name
}

function renameResponse(draft: Draft, from: string, to: string): Draft {
  const responses: Record<string, MockResponse> = {}
  const bodies: Record<string, string> = {}
  // Reconstruir en orden preserva la posición en la lista; un delete+set la
  // mandaría al final cada vez que renombrás.
  for (const [name, response] of Object.entries(draft.responses)) {
    const key = name === from ? to : name
    responses[key] = response
    bodies[key] = draft.bodies[name] ?? ''
  }
  return {
    ...draft,
    responses,
    bodies,
    default: draft.default === from ? to : draft.default,
  }
}

function deleteResponse(draft: Draft, name: string): Draft {
  const responses = { ...draft.responses }
  const bodies = { ...draft.bodies }
  delete responses[name]
  delete bodies[name]
  const remaining = Object.keys(responses)
  return {
    ...draft,
    responses,
    bodies,
    // `default` tiene que nombrar una respuesta que exista o el archivo
    // queda inválido y el endpoint deja de servirse.
    default: draft.default === name ? (remaining[0] ?? '') : draft.default,
  }
}

function omitBody(response: MockResponse): MockResponse {
  const { body: _body, ...rest } = response
  return rest
}

function sameDefinition(draft: Draft, endpoint: Endpoint): boolean {
  const rebuilt: Record<string, unknown> = {}
  for (const [name, response] of Object.entries(draft.responses)) {
    const source = (draft.bodies[name] ?? '').trim()
    let body: unknown
    try {
      body = source === '' ? undefined : JSON.parse(source)
    } catch {
      // Un cuerpo a medio escribir cuenta como cambio: es exactamente lo
      // que el developer está haciendo en ese momento.
      return false
    }
    rebuilt[name] = { ...omitBody(response), ...(body === undefined ? {} : { body }) }
  }

  const original: Record<string, unknown> = {}
  for (const [name, response] of Object.entries(endpoint.responses)) {
    original[name] = {
      ...omitBody(response),
      ...(response.body === undefined ? {} : { body: response.body }),
    }
  }

  return (
    JSON.stringify(rebuilt) === JSON.stringify(original) &&
    draft.default === endpoint.default &&
    draft.description.trim() === (endpoint.description ?? '')
  )
}
