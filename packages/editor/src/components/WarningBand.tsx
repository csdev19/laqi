/**
 * Un warning de generación no es un error: la operación funcionó y produjo
 * datos, solo que degradados (un índice descartado, un import que no se
 * pudo resolver). `role="status"` porque es informativo y no debe robar el
 * foco ni interrumpir como un `alert`; dismissible porque no es una
 * condición persistente como la de compartir.
 */
export function WarningBand(props: { warnings: string[]; onDismiss: () => void }) {
  if (props.warnings.length === 0) return null

  return (
    <div className="band band-warning" role="status" aria-label="generation warnings">
      <div className="band-body">
        <div className="band-title">
          {props.warnings.length === 1 ? 'generation warning' : `${props.warnings.length} generation warnings`}
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
