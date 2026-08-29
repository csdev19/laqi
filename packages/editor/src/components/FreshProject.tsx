const EXAMPLE = `{
  "GET /users": {
    "default": "ok",
    "responses": {
      "ok": { "status": 200, "body": [{ "id": 1, "name": "Ada" }] },
      "empty": { "status": 200, "body": [] },
      "boom": { "status": 500, "body": { "message": "boom" } }
    }
  }
}`

/**
 * A target to paste into, not a welcome screen: left-aligned, at the top of
 * the panel, no illustration.
 */
export function FreshProject(props: { watching: string; onCreate: () => void }) {
  return (
    <div className="empty">
      <h2>No endpoints loaded</h2>
      <p>
        laqi is watching <span className="mono">{props.watching}</span> and has not found any mock
        definitions yet. Drop a file like this one in there:
      </p>
      <pre>{EXAMPLE}</pre>
      <div className="empty-actions">
        <button type="button" className="btn btn-primary" onClick={props.onCreate}>
          Create first endpoint
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => void navigator.clipboard?.writeText(EXAMPLE)}
        >
          Copy example file
        </button>
      </div>
    </div>
  )
}
