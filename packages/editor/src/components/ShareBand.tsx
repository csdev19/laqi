import { useState } from 'react'
import type { Share } from '../types'

/**
 * Una banda, no un panel ni un modal: la exposición es una CONDICIÓN
 * persistente, no una tarea. Tiene que estar en toda captura de pantalla que
 * el developer saque y ser imposible de olvidar.
 */
export function ShareBand(props: { share: Share }) {
  const [revealed, setRevealed] = useState(false)
  const { url, token } = props.share

  const curl = url
    ? `curl ${token ? `-H 'Authorization: Bearer ${token}' ` : ''}${url}/`
    : ''

  return (
    <div className="band band-share" role="status">
      <span className="share-dot" aria-hidden="true" />

      <div className="band-body">
        <div className="band-title">EXPOSED TO THE INTERNET</div>

        {url === null ? (
          <div className="band-message mono">opening the tunnel…</div>
        ) : (
          <div className="band-message mono share-url">{url}</div>
        )}

        {token === null ? (
          <div className="share-warning">
            No token — anyone with this URL can read your mocks. Restart without{' '}
            <span className="mono">--public</span> to require one.
          </div>
        ) : (
          <div className="share-token mono">
            <span className="micro">token</span>{' '}
            {revealed ? token : '•'.repeat(token.length)}
          </div>
        )}

        {/* La garantía del H1, escrita. Sin esto es invisible. */}
        <div className="band-note">{props.share.exposed}</div>
      </div>

      <div className="band-actions">
        {token === null ? null : (
          <button type="button" className="btn" onClick={() => setRevealed((r) => !r)}>
            {revealed ? 'Hide token' : 'Reveal token'}
          </button>
        )}
        {url === null ? null : (
          <>
            <button
              type="button"
              className="btn"
              onClick={() => void navigator.clipboard?.writeText(url)}
            >
              Copy URL
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => void navigator.clipboard?.writeText(curl)}
            >
              Copy curl
            </button>
          </>
        )}
      </div>
    </div>
  )
}
