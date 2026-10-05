import { useSyncExternalStore } from 'react'
import { lastRequestStore } from '../lib/api'

/**
 * One line: the request the app just made and the status laqi answered
 * with. The panel's log shows the same request on the other side, so a
 * viewer can match a click here to the response chosen there.
 */
export function LastRequest() {
  const last = useSyncExternalStore(lastRequestStore.subscribe, lastRequestStore.get, () => null)

  if (!last) {
    return (
      <p className="last-request" aria-live="polite">
        <span className="muted">no requests yet</span>
      </p>
    )
  }

  const ok = last.status < 400
  return (
    <p className="last-request" aria-live="polite">
      <span className={`lr-method lr-${last.method}`}>{last.method}</span>
      <span className="lr-path">{last.path}</span>
      <span className="lr-arrow" aria-hidden="true">
        →
      </span>
      <span className={ok ? 'lr-status is-ok' : 'lr-status is-error'}>{last.status}</span>
    </p>
  )
}
