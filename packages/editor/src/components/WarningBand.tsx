/**
 * A generation warning is not an error: the operation succeeded and
 * produced data, just degraded (a dropped index signature, an import that
 * couldn't be resolved). `role="status"` because it's informative and
 * shouldn't steal focus or interrupt like an `alert`; dismissible because
 * it's not a persistent condition like the sharing one.
 */
export function WarningBand(props: { warnings: string[]; onDismiss: () => void }) {
  if (props.warnings.length === 0) return null

  return (
    <div className="band band-warning" role="status" aria-label="generation warnings">
      <div className="band-body">
        <div className="band-title">
          {props.warnings.length === 1
            ? 'generation warning'
            : `${props.warnings.length} generation warnings`}
        </div>
        <ul className="band-warning-list">
          {props.warnings.map((warning, index) => (
            <li key={`${index}-${warning}`}>{warning}</li>
          ))}
        </ul>
      </div>

      <div className="band-actions">
        <button type="button" className="btn" onClick={props.onDismiss}>
          Dismiss
        </button>
      </div>
    </div>
  )
}
