import type { LoadError } from '../types'

/**
 * Un archivo de mock roto es la falla más común, y el panel es el único
 * lugar donde el developer está mirando cuando pasa — por eso el detalle
 * va inline y no detrás de un click.
 */
export function ErrorBand(props: { errors: LoadError[]; onReload: () => void }) {
  const [first, ...rest] = props.errors
  if (!first) return null

  return (
    <div className="band band-error" role="alert">
      <div className="band-body">
        <div className="band-title mono">{position(first)}</div>
        <div className="band-message">{first.message}</div>
        {first.excerpt ? <pre className="band-excerpt">{first.excerpt}</pre> : null}
        <div className="band-note">The rest of the mocks are still being served.</div>
        {rest.length > 0 ? (
          <div className="band-more">
            and {rest.length} more {rest.length === 1 ? 'file' : 'files'} failed to load
          </div>
        ) : null}
      </div>

      <div className="band-actions">
        <button type="button" className="btn" onClick={props.onReload}>
          Reload file
        </button>
      </div>
    </div>
  )
}

function position(error: LoadError): string {
  const parts = [error.file]
  if (error.line !== undefined) parts.push(String(error.line))
  if (error.col !== undefined) parts.push(String(error.col))
  return parts.join(':')
}
