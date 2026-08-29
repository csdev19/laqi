import { resolvedText, statusClass } from '../log'
import type { LogEntry } from '../types'

const LEGEND = [
  { layer: 'header', color: 'var(--mint)' },
  { layer: 'state', color: 'var(--mag)' },
  { layer: 'scenario', color: 'var(--vio)' },
  { layer: 'default', color: 'var(--dim2)' },
]

export function RequestLog(props: {
  entries: LogEntry[]
  paused: boolean
  onTogglePause: () => void
  onClear: () => void
  onJump: (endpointId: string) => void
}) {
  return (
    <aside className="pane-log">
      <div className="log-header">
        <span className={props.paused ? 'live-dot is-paused' : 'live-dot'} aria-hidden="true" />
        <span className="micro">requests · {props.entries.length}</span>
        <div className="log-actions">
          <button type="button" className="btn" onClick={props.onTogglePause}>
            {props.paused ? 'Resume' : 'Pause'}
          </button>
          <button type="button" className="btn" onClick={props.onClear}>
            Clear
          </button>
        </div>
      </div>

      <div className="log-rows">
        {props.entries.length === 0 ? (
          <div className="log-empty">
            Waiting for requests.
            <br />
            Trigger one from your app and it lands here.
          </div>
        ) : (
          props.entries.map((entry) => <Row key={entry.seq} entry={entry} onJump={props.onJump} />)
        )}
      </div>

      <div className="log-legend">
        {LEGEND.map((item) => (
          <span key={item.layer} className="legend-item">
            <span className="legend-swatch" style={{ background: item.color }} aria-hidden="true" />
            <span className="micro">{item.layer}</span>
          </span>
        ))}
      </div>
    </aside>
  )
}

function Row(props: { entry: LogEntry; onJump: (endpointId: string) => void }) {
  const { entry } = props
  const noRoute = entry.endpointId === null

  return (
    <div className={noRoute ? 'log-row is-no-route' : 'log-row'}>
      <span className="log-time">{entry.time}</span>
      <span className={`log-method method-${entry.method}`}>{entry.method}</span>

      {/* A no-route row doesn't go anywhere: there's no endpoint to open. */}
      {noRoute ? (
        <span className="log-path">{entry.path}</span>
      ) : (
        <button
          type="button"
          className="log-path"
          onClick={() => props.onJump(entry.endpointId as string)}
        >
          {entry.path}
        </button>
      )}

      <span className={`log-status status-${statusClass(entry.status)}`}>{entry.status}</span>
      <span className={`log-resolved layer-${entry.resolvedLayer}`}>{resolvedText(entry)}</span>
      <span className="log-ms">{entry.ms}ms</span>
    </div>
  )
}
