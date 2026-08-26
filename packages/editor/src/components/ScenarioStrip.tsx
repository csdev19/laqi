import type { Scenarios } from '../types'

export function ScenarioStrip(props: {
  scenarios: Scenarios
  active: string | null
  dirty: boolean
  onActivate: (name: string | null) => void
  onReset: () => void
}) {
  const names = Object.keys(props.scenarios)

  return (
    <div className="scenarios">
      <span className="micro">scenarios</span>

      {names.length === 0 ? (
        <span className="scenarios-empty">
          none declared — add a scenarios.json next to your mocks
        </span>
      ) : (
        names.map((name) => {
          const isActive = props.active === name
          return (
            <button
              key={name}
              type="button"
              className={isActive ? 'scenario-chip is-active' : 'scenario-chip'}
              aria-pressed={isActive}
              // Click de nuevo = desactivar. Toda acción destructiva está a
              // un click de revertirse.
              onClick={() => props.onActivate(isActive ? null : name)}
            >
              {name}
              <span className="scenario-count">
                {Object.keys(props.scenarios[name] ?? {}).length}
              </span>
            </button>
          )
        })
      )}

      {props.dirty ? (
        <button type="button" className="btn btn-danger scenarios-reset" onClick={props.onReset}>
          Reset all to default
        </button>
      ) : null}
    </div>
  )
}
