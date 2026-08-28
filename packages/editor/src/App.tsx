import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError, type EndpointDefinition } from './api'
import { CommandPalette } from './components/CommandPalette'
import { CreateEndpointRow, type CreateInput } from './components/CreateEndpointRow'
import { EndpointDetail } from './components/EndpointDetail'
import { EndpointRow } from './components/EndpointRow'
import { ErrorBand } from './components/ErrorBand'
import { FreshProject } from './components/FreshProject'
import { Header } from './components/Header'
import { RequestLog } from './components/RequestLog'
import { ScenarioStrip } from './components/ScenarioStrip'
import { ShareBand } from './components/ShareBand'
import { WarningBand } from './components/WarningBand'
import { useEvents } from './hooks/useEvents'
import { appendLog, toLogEntry } from './log'
import { isDirty, overriddenCount, overridesAfterChipClick } from './resolve'
import { filterEndpoints } from './search'
import type { Endpoint, LaqiState, LogEntry, Scenarios, Status } from './types'

const EMPTY_STATE: LaqiState = { scenario: null, overrides: {} }

export function App() {
  const [endpoints, setEndpoints] = useState<Endpoint[]>([])
  const [state, setState] = useState<LaqiState>(EMPTY_STATE)
  const [scenarios, setScenarios] = useState<Scenarios>({})
  const [status, setStatus] = useState<Status | null>(null)
  const [loaded, setLoaded] = useState(false)

  const [log, setLog] = useState<LogEntry[]>([])
  const [paused, setPaused] = useState(false)
  const seq = useRef(0)

  const [filter, setFilter] = useState('')
  const [detailId, setDetailId] = useState<string | null>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [creating, setCreating] = useState(false)

  const [fatal, setFatal] = useState<string | null>(null)
  const [createError, setCreateError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])

  const filterRef = useRef<HTMLInputElement>(null)

  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const refresh = useCallback(async () => {
    try {
      const [nextEndpoints, nextState, nextScenarios, nextStatus] = await Promise.all([
        api.getEndpoints(),
        api.getState(),
        api.getScenarios(),
        api.getStatus(),
      ])
      setEndpoints(nextEndpoints)
      setState(nextState)
      setScenarios(nextScenarios)
      setStatus(nextStatus)
      setFatal(null)
    } catch (error) {
      setFatal(error instanceof ApiError ? error.message : String(error))
    } finally {
      setLoaded(true)
    }
  }, [])

  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current !== null) clearTimeout(refreshTimer.current)
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = null
      void refresh()
    }, 40)
  }, [refresh])

  useEffect(() => {
    void refresh()
    return () => {
      if (refreshTimer.current !== null) clearTimeout(refreshTimer.current)
    }
  }, [refresh])

  useEvents(
    useCallback(
      (event) => {
        if (event.type === 'request') {
          if (paused) return
          // La entrada se arma ACÁ, no adentro del updater: EventSource
          // despacha en un mismo tick todos los frames que llegaron juntos,
          // y los updaters corren después — los dos leerían el mismo
          // seq.current y producirían dos filas con la misma key de React.
          const entry = toLogEntry(event, ++seq.current, new Date())
          setLog((previous) => appendLog(previous, entry))
          return
        }
        // Tanto una recarga como un error de parseo cambian lo que hay que
        // mostrar: la fuente de verdad sigue siendo el servidor, no el
        // evento. Se agrupa porque un solo guardado emite un
        // `endpoints-changed` más un `error` por archivo roto, y cada uno
        // dispararía cuatro GETs contra el control plane.
        scheduleRefresh()
      },
      [paused, scheduleRefresh],
    ),
  )

  /**
   * Pintar optimista: misma máquina, latencia cero — nunca un spinner. Si el
   * PUT falla, el estado vuelve a lo que había y el servidor tiene la última
   * palabra.
   */
  const commitState = useCallback(async (next: LaqiState, previous: LaqiState) => {
    setState(next)
    try {
      setState(await api.putState(next))
    } catch (error) {
      setState(previous)
      setFatal(error instanceof ApiError ? error.message : String(error))
    }
  }, [])

  const flip = useCallback(
    (endpoint: Endpoint, response: string) => {
      const overrides = overridesAfterChipClick({ endpoint, state, scenarios, clicked: response })
      void commitState({ ...state, overrides }, state)
    },
    [state, scenarios, commitState],
  )

  const activateScenario = useCallback(
    (name: string | null) => void commitState({ ...state, scenario: name }, state),
    [state, commitState],
  )

  const resetAll = useCallback(() => void commitState(EMPTY_STATE, state), [state, commitState])

  const create = useCallback(
    async (input: CreateInput) => {
      setCreateError(null)
      try {
        const { id } = await api.createEndpoint({
          method: input.method,
          path: input.path,
          default: input.responseName,
          responses: {
            [input.responseName]: { status: input.status, body: input.body ?? {} },
          },
        })
        setCreating(false)
        await refresh()
        setDetailId(id)
      } catch (error) {
        setCreateError(error instanceof ApiError ? error.message : String(error))
      }
    },
    [refresh],
  )

  const createFromModel = useCallback(
    async (input: { method: string; path: string; model: string }) => {
      setCreateError(null)
      setWarnings([])
      try {
        const { preview, warnings: generationWarnings } = await api.generateData({
          model: input.model,
        })
        // `create()` closes the CreateEndpointRow and opens the new
        // endpoint's detail — the warnings state lives here, not there, so
        // it survives that transition instead of unmounting with the row.
        setWarnings(generationWarnings)
        await create({
          method: input.method,
          path: input.path,
          responseName: 'ok',
          status: 200,
          body: preview,
        })
      } catch (error) {
        setCreateError(error instanceof ApiError ? error.message : String(error))
      }
    },
    [create],
  )

  const save = useCallback(
    async (id: string, definition: EndpointDefinition) => {
      setSaveError(null)
      try {
        await api.updateEndpoint(id, definition)
        await refresh()
      } catch (error) {
        setSaveError(error instanceof ApiError ? error.message : String(error))
      }
    },
    [refresh],
  )

  const remove = useCallback(
    async (id: string) => {
      setSaveError(null)
      try {
        await api.deleteEndpoint(id)
        setDetailId(null)
        await refresh()
      } catch (error) {
        setSaveError(error instanceof ApiError ? error.message : String(error))
      }
    },
    [refresh],
  )

  // esc siempre significa "un nivel arriba", en un orden predecible:
  // paleta → crear → detalle.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setPaletteOpen((open) => !open)
        return
      }

      if (event.key === 'Escape') {
        if (paletteOpen) setPaletteOpen(false)
        else if (creating) setCreating(false)
        else if (detailId) setDetailId(null)
        return
      }

      const target = event.target as HTMLElement | null
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable === true
      if (typing) return

      if (event.key === '/') {
        event.preventDefault()
        filterRef.current?.focus()
      } else if (event.key === 'p' && !detailId) {
        setPaused((current) => !current)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [paletteOpen, creating, detailId])

  const detail = detailId ? endpoints.find((endpoint) => endpoint.id === detailId) : undefined
  const shown = filterEndpoints(endpoints, filter)
  const errors = status?.errors ?? []

  return (
    <div className="app">
      <Header
        status={status}
        endpointCount={endpoints.length}
        failedFiles={errors.length}
        overridden={overriddenCount({ endpoints, state, scenarios })}
        onOpenPalette={() => setPaletteOpen(true)}
      />

      {fatal ? (
        <div className="band band-error" role="alert">
          <div className="band-body">
            <div className="band-title mono">control plane</div>
            <div className="band-message">{fatal}</div>
          </div>
          <div className="band-actions">
            <button type="button" className="btn" onClick={() => void refresh()}>
              Retry
            </button>
          </div>
        </div>
      ) : null}

      {status?.share ? <ShareBand share={status.share} /> : null}

      {errors.length > 0 ? <ErrorBand errors={errors} onReload={() => void refresh()} /> : null}

      <WarningBand warnings={warnings} onDismiss={() => setWarnings([])} />

      <div className="panes">
        <main className="pane-endpoints">
          {detail ? (
            <EndpointDetail
              endpoint={detail}
              state={state}
              scenarios={scenarios}
              address={status?.address ?? 'localhost:8000'}
              saveError={saveError}
              onBack={() => setDetailId(null)}
              onFlip={flip}
              onSave={(id, definition) => void save(id, definition)}
              onDelete={(id) => void remove(id)}
            />
          ) : (
            <>
              <ScenarioStrip
                scenarios={scenarios}
                active={state.scenario}
                dirty={isDirty(state)}
                onActivate={activateScenario}
                onReset={resetAll}
              />

              <div className="filter-row">
                <input
                  ref={filterRef}
                  className="filter-input"
                  placeholder="filter by method, path, description or response name  (/)"
                  aria-label="filter"
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                />
                <span className="micro filter-count">{shown.length} shown</span>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    setCreateError(null)
                    setCreating(true)
                  }}
                >
                  + New endpoint
                </button>
              </div>

              {creating ? (
                <CreateEndpointRow
                  error={createError}
                  onCreate={(input) => void create(input)}
                  onCreateFromModel={(input) => void createFromModel(input)}
                  onCancel={() => setCreating(false)}
                />
              ) : null}

              <div className="endpoint-list">
                {endpoints.length === 0 && loaded && !fatal ? (
                  <FreshProject
                    watching={status?.watching ?? './laqi/'}
                    onCreate={() => setCreating(true)}
                  />
                ) : shown.length === 0 ? (
                  <div className="empty">
                    <p>
                      No endpoint matches <span className="mono">{filter}</span>.
                    </p>
                  </div>
                ) : (
                  shown.map((endpoint) => (
                    <EndpointRow
                      key={endpoint.id}
                      endpoint={endpoint}
                      state={state}
                      scenarios={scenarios}
                      showDescription
                      onFlip={flip}
                      onOpen={setDetailId}
                    />
                  ))
                )}
              </div>
            </>
          )}
        </main>

        <RequestLog
          entries={log}
          paused={paused}
          onTogglePause={() => setPaused((current) => !current)}
          onClear={() => setLog([])}
          onJump={setDetailId}
        />
      </div>

      {paletteOpen ? (
        <CommandPalette
          endpoints={endpoints}
          state={state}
          scenarios={scenarios}
          onFlip={flip}
          onOpen={setDetailId}
          onClose={() => setPaletteOpen(false)}
        />
      ) : null}
    </div>
  )
}
