import { useEffect, useMemo, useRef, useState } from 'react'
import { api, ApiError, type EndpointDefinition } from '../api'
import { checkJson } from '../highlight'
import { statusClass } from '../log'
import { parseStatusCode, suggestResponses, type GenerationEvidence } from '@laqi/schema'
import { StatusSelect } from './StatusSelect'
import { TypesPanel } from './TypesPanel'
import { liveResponse } from '../resolve'
import type { Endpoint, LaqiState, MockResponse, Scenarios } from '../types'
import { Dialog } from './Dialog'
import { JsonEditor, ValidityReadout } from './JsonEditor'
import { ModelEditor } from './ModelEditor'
import { WarningBand } from './WarningBand'

type Draft = {
  description: string
  default: string
  responses: Record<string, MockResponse>
  /** The body is edited as text: half-written JSON isn't parseable. */
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
  const [actionError, setActionError] = useState<string | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const [renameValue, setRenameValue] = useState<string | null>(null)

  /**
   * A regenerate waiting to be written, with everything the write needs.
   *
   * The body also goes into the draft so it can be read and edited, but the
   * draft alone cannot be applied: the evidence says how this body was
   * produced and the revision says which response it was decided about, and
   * a write without both is the silent overwrite the revision exists to
   * prevent.
   */
  const [pending, setPending] = useState<{
    response: string
    body: unknown
    evidence: GenerationEvidence
    revision: string
  } | null>(null)
  /** A refused write, with the reason and the revision that is current now. */
  const [conflict, setConflict] = useState<{ message: string; revision: string } | null>(null)

  /**
   * A model laqi drafted from the body, on screen for the person to accept
   * or fix before it becomes this response's schema.
   *
   * Drafted rather than stored on sight: inference reads one sample, so it
   * cannot tell a literal union from a string or a fixed tuple from a list.
   * Showing the draft is what turns that from a silent guess into something
   * someone looked at — and if it is right, accepting it is one click.
   */
  const [draftModel, setDraftModel] = useState<{ source: string; typeName: string } | null>(null)
  const [savingModel, setSavingModel] = useState(false)

  // This bumps every time the fingerprint changes (see below). Regenerate
  // captures the current value when it starts and compares it on resolve:
  // if they no longer match, a reload won in the meantime and the late
  // response is discarded rather than overwriting the fresh draft. It does
  // not depend on the component unmounting — a reload rerenders the same
  // instance.
  const epochRef = useRef(0)

  // The watcher can reload the endpoint out from under you (someone edited
  // the file by hand). Rebuild the draft from the new definition.
  //
  // The dependency is the CONTENT, not the object identity: `refresh()`
  // returns new objects on every call even when nothing changed, and any
  // unrelated reload (the watcher, an agent writing via MCP, another tab
  // saving) used to wipe out what you were typing.
  const fingerprint = JSON.stringify([
    endpoint.id,
    endpoint.description,
    endpoint.default,
    endpoint.responses,
  ])
  useEffect(() => {
    epochRef.current += 1
    setDraft(toDraft(endpoint))
    // The file moved under us, so a preview decided about the old one is no
    // longer something anyone agreed to write.
    setPending(null)
    setConflict(null)
    setSelected((current) => (current in endpoint.responses ? current : endpoint.default))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `endpoint` is deliberately omitted: see above
  }, [fingerprint])

  const live = liveResponse({ endpoint, state, scenarios })
  const names = Object.keys(draft.responses)
  const current = draft.responses[selected]
  const bodySource = draft.bodies[selected] ?? ''

  // The endpoint id is `METHOD /path`; both halves decide the family. Read
  // from the draft, not the endpoint, so the button disappears the moment
  // the responses are added rather than after the file is saved.
  const missing = suggestResponses({
    method: endpoint.method,
    path: endpoint.path,
    existing: Object.keys(draft.responses),
  })

  const dirty = useMemo(() => !sameDefinition(draft, endpoint), [draft, endpoint])

  const patch = (name: string, change: Partial<MockResponse>) => {
    setDraft((previous) => ({
      ...previous,
      responses: { ...previous.responses, [name]: { ...previous.responses[name]!, ...change } },
    }))
  }

  /** Whether this response already knows what shape it is. */
  const hasSchema = endpoint.responses[selected]?.schema !== undefined

  /**
   * Reads back the types laqi derives from the body and puts them on screen
   * as an editable model. Nothing is written; this is the draft step.
   */
  const buildModel = () => {
    const epoch = epochRef.current
    setActionError(null)
    setConflict(null)
    void api
      .getTypes(endpoint.id, { response: selected, lang: 'typescript' })
      .then((derived) => {
        if (epochRef.current !== epoch) return
        setDraftModel({ source: derived.code, typeName: derived.typeName })
      })
      .catch((error: unknown) => {
        if (epochRef.current !== epoch) return
        setActionError(error instanceof Error ? error.message : String(error))
      })
  }

  /**
   * Turns the model on screen into this response's schema.
   *
   * Imported as an ordinary pasted model, because that is what it now is:
   * text a person read and accepted. There is no separate "inferred" kind to
   * store — it would be a new shape in everyone's mock files, and it would
   * say less than this does, which is that someone approved this text.
   */
  const saveModel = () => {
    if (draftModel === null) return
    const epoch = epochRef.current
    setActionError(null)
    setSavingModel(true)
    void api
      .importSchema({
        kind: 'typescript-paste',
        source: draftModel.source,
        typeName: draftModel.typeName,
      })
      .then(({ snapshot }) =>
        api
          .getResponseRevision(endpoint.id, selected)
          .then(({ revision }) =>
            api.setResponseSchema(endpoint.id, selected, { snapshot, revision }),
          ),
      )
      .then(() => {
        if (epochRef.current !== epoch) return
        setDraftModel(null)
        setWarnings(['schema saved — Regenerate now builds bodies from it'])
      })
      .catch((error: unknown) => {
        if (epochRef.current !== epoch) return
        setActionError(error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        if (epochRef.current === epoch) setSavingModel(false)
      })
  }

  /** Whether this response's schema names a file a refresh could re-read. */
  const refreshable = (() => {
    const source = endpoint.responses[selected]?.schema?.source
    return source !== undefined && source.kind !== 'typescript-paste' && source.file !== undefined
  })()

  /**
   * Writes the pending body through the one path that checks the revision
   * and the evidence. A refusal is shown where the decision is, with the
   * revision that is current now, so confirming resends against the file as
   * it actually stands rather than against the one the preview saw.
   */
  const applyPending = (confirm?: { revision: string }) => {
    if (pending === null) return
    const epoch = epochRef.current
    setActionError(null)
    setConflict(null)
    void api
      .applyGeneratedBody(endpoint.id, pending.response, {
        body: pending.body,
        evidence: pending.evidence,
        revision: confirm?.revision ?? pending.revision,
        ...(confirm === undefined ? {} : { confirm: true }),
      })
      .then(() => {
        if (epochRef.current !== epoch) return
        setPending(null)
      })
      .catch((error: unknown) => {
        if (epochRef.current !== epoch) return
        if (error instanceof ApiError && error.conflict) {
          setConflict({ message: error.message, revision: error.conflict.revision })
          return
        }
        setActionError(error instanceof Error ? error.message : String(error))
      })
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
      {/* A refused write, answered where the decision is. The button resends
          against the revision that is current NOW, not the one the preview
          saw — confirming means "overwrite what is there", not "ignore that
          something changed". */}
      {conflict !== null ? (
        <div className="band band-error conflict-band">
          <span>{conflict.message}</span>
          <button
            type="button"
            className="btn"
            onClick={() => applyPending({ revision: conflict.revision })}
          >
            Overwrite anyway
          </button>
        </div>
      ) : null}

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

          {missing.length > 0 ? (
            <button
              type="button"
              className="add-response add-response-scaffold"
              // The names are in the label, not a tooltip: this button writes
              // into the user's repository, so what it will do has to be
              // readable before it is pressed, not after.
              onClick={() => {
                setDraft((previous) => ({
                  ...previous,
                  responses: {
                    ...previous.responses,
                    ...Object.fromEntries(
                      missing.map((suggestion) => [suggestion.name, suggestion.response]),
                    ),
                  },
                  bodies: {
                    ...previous.bodies,
                    ...Object.fromEntries(
                      missing.map((suggestion) => [
                        suggestion.name,
                        // A 204 carries no body key at all; the editor shows
                        // an empty string, which `save` turns back into an
                        // omitted body rather than the string "undefined".
                        'body' in suggestion.response
                          ? JSON.stringify(suggestion.response.body, null, 2)
                          : '',
                      ]),
                    ),
                  },
                }))
                setSelected(missing[0]!.name)
              }}
            >
              + add {missing.map((suggestion) => suggestion.name).join(', ')}
            </button>
          ) : null}
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
                  setConflict(null)
                  void api
                    .regenerateResponse(endpoint.id, selected)
                    .then((generated) => {
                      // Discard if the endpoint reloaded while the call was
                      // in flight: the reload already rebuilt the draft and
                      // this response no longer belongs to it.
                      if (epochRef.current !== epoch) return
                      setDraft((previous) => ({
                        ...previous,
                        bodies: {
                          ...previous.bodies,
                          [selected]: JSON.stringify(generated.body, null, 2),
                        },
                      }))
                      setPending({
                        response: selected,
                        body: generated.body,
                        evidence: generated.evidence,
                        revision: generated.revision,
                      })
                      setWarnings(generated.diagnostics.map((item) => item.message))
                    })
                    .catch((error: unknown) => {
                      if (epochRef.current !== epoch) return
                      setActionError(error instanceof Error ? error.message : String(error))
                    })
                }}
              >
                Regenerate
              </button>
              {/* Only after a regenerate, and only for the response it was
                  about: applying carries the evidence that says laqi produced
                  these bytes, which a hand-edited draft cannot claim. */}
              {pending?.response === selected ? (
                <button type="button" className="btn btn-primary" onClick={() => applyPending()}>
                  Apply generated
                </button>
              ) : null}
              {/* Regenerate refuses a response with no schema, so the way
                  out of that refusal sits right next to it rather than in
                  a menu the person has to go looking for. */}
              {!hasSchema && draftModel === null ? (
                <button type="button" className="btn" onClick={buildModel}>
                  Build model
                </button>
              ) : null}
              {/* Only when there is a file to re-read. A pasted model was
                  never kept, so there is nothing to refresh from. */}
              {refreshable ? (
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    const epoch = epochRef.current
                    setActionError(null)
                    setConflict(null)
                    void api
                      .getResponseRevision(endpoint.id, selected)
                      .then(({ revision }) =>
                        api.refreshSchema(endpoint.id, selected, { revision }),
                      )
                      .then(() => {
                        if (epochRef.current !== epoch) return
                        setWarnings(['schema refreshed from its source — the body is unchanged'])
                      })
                      .catch((error: unknown) => {
                        if (epochRef.current !== epoch) return
                        setActionError(error instanceof Error ? error.message : String(error))
                      })
                  }}
                >
                  Refresh schema
                </button>
              ) : null}
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

          {/* The draft, in full and editable. laqi read one body to write
              it, so the two things it cannot know are named — and the
              person is the one who knows them. */}
          {draftModel !== null ? (
            <div className="model-draft">
              <div className="editor-toolbar">
                <span className="micro">
                  model for {draftModel.typeName} — read from this body. A literal union reads as
                  string here, and a fixed tuple as a list; fix those and it is exact.
                </span>
                <div className="header-actions">
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={savingModel}
                    onClick={saveModel}
                  >
                    {savingModel ? 'Saving…' : 'Save as schema'}
                  </button>
                  <button type="button" className="btn" onClick={() => setDraftModel(null)}>
                    Cancel
                  </button>
                </div>
              </div>
              <ModelEditor
                value={draftModel.source}
                label="model"
                onChange={(source) =>
                  setDraftModel((previous) => (previous ? { ...previous, source } : previous))
                }
              />
            </div>
          ) : null}
        </div>

        <div className="detail-meta">
          {current ? (
            <>
              <div className="meta-field">
                <label className="micro" htmlFor="meta-status">
                  status
                </label>
                <StatusSelect
                  id="meta-status"
                  label="status"
                  value={String(current.status)}
                  // Same guard as the create row: `Number('201e44')` is
                  // 2.01e46, which the file would take and the schema would
                  // then reject with a message about integer limits.
                  onChange={(next) =>
                    patch(selected, { status: parseStatusCode(next) ?? current.status })
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
                {/* Teaches the header layer by showing it, which is how you
                    test a response without touching the app. */}
                <pre className="meta-curl">{curlFor(endpoint, selected, props.address)}</pre>
              </div>

              <TypesPanel
                endpointId={endpoint.id}
                responseName={selected}
                response={endpoint.responses[selected]}
                revision={fingerprint}
              />

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
  // Rebuilding in order preserves the position in the list; a delete+set
  // would send it to the end every time you rename.
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
    // `default` has to name a response that exists or the file becomes
    // invalid and the endpoint stops being served.
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
      // A half-written body counts as a change: it's exactly what the
      // developer is doing at that moment.
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
