import { statusClass } from '../log'
import { liveResponse } from '../resolve'
import type { Endpoint, LaqiState, Scenarios } from '../types'

export function EndpointRow(props: {
  endpoint: Endpoint
  state: LaqiState
  scenarios: Scenarios
  showDescription: boolean
  onFlip: (endpoint: Endpoint, response: string) => void
  onOpen: (id: string) => void
}) {
  const { endpoint, state, scenarios, showDescription } = props
  const live = liveResponse({ endpoint, state, scenarios })

  return (
    <div className={`endpoint-row is-${live.layer}`} data-endpoint-id={endpoint.id}>
      <span className={`row-marker layer-${live.layer}`} aria-hidden="true" />

      <span className={`row-method method-${endpoint.method}`}>{endpoint.method}</span>

      <span className="row-main">
        <button type="button" className="row-path" onClick={() => props.onOpen(endpoint.id)}>
          {endpoint.path}
        </button>
        {showDescription && endpoint.description ? (
          <span className="row-description">{endpoint.description}</span>
        ) : null}
      </span>

      <span className="row-chips">
        {Object.entries(endpoint.responses).map(([name, response]) => {
          const isLive = name === live.name
          return (
            <button
              key={name}
              type="button"
              className={isLive ? `chip is-live layer-${live.layer}` : 'chip'}
              aria-pressed={isLive}
              title={`${name} · ${response.status}${response.delay ? ` · ${response.delay}ms` : ''}`}
              onClick={() => props.onFlip(endpoint, name)}
            >
              {name}
              <span className={`chip-status status-${statusClass(response.status)}`}>
                {response.status}
              </span>
            </button>
          )
        })}
      </span>

      <span
        className={
          live.layer === 'default' ? 'row-layer' : `row-layer is-not-default layer-${live.layer}`
        }
      >
        {live.layer}
      </span>
    </div>
  )
}
