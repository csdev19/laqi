import { useEffect, useState } from 'react'
import { liveResponse } from '../resolve'
import { paletteResults } from '../search'
import type { Endpoint, LaqiState, Scenarios } from '../types'

export function CommandPalette(props: {
  endpoints: Endpoint[]
  state: LaqiState
  scenarios: Scenarios
  onFlip: (endpoint: Endpoint, response: string) => void
  onOpen: (id: string) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const results = paletteResults(props.endpoints, query)

  // A result list that shrinks under the cursor would leave the highlight
  // out of range and ↵ would do nothing.
  useEffect(() => {
    setHighlight(0)
  }, [query])

  const choose = (index: number, openDetail: boolean) => {
    const result = results[index]
    if (!result) return
    if (openDetail) props.onOpen(result.endpoint.id)
    else props.onFlip(result.endpoint, result.response)
    props.onClose()
  }

  return (
    <div
      className="palette-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) props.onClose()
      }}
    >
      <div className="palette" role="dialog" aria-label="Jump to endpoint">
        <input
          className="palette-input"
          placeholder="orders boom"
          aria-label="command"
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              setHighlight((current) => Math.min(current + 1, results.length - 1))
            } else if (event.key === 'ArrowUp') {
              event.preventDefault()
              setHighlight((current) => Math.max(current - 1, 0))
            } else if (event.key === 'Enter') {
              event.preventDefault()
              choose(highlight, event.metaKey || event.ctrlKey)
            }
          }}
        />

        <div className="palette-results">
          {results.length === 0 ? (
            <div className="palette-empty">nothing matches “{query}”</div>
          ) : (
            results.map((result, index) => {
              const live = liveResponse({
                endpoint: result.endpoint,
                state: props.state,
                scenarios: props.scenarios,
              })
              const isLive = live.name === result.response

              return (
                <button
                  key={`${result.endpoint.id}::${result.response}`}
                  type="button"
                  className={index === highlight ? 'palette-row is-highlighted' : 'palette-row'}
                  onMouseEnter={() => setHighlight(index)}
                  onClick={(event) => choose(index, event.metaKey || event.ctrlKey)}
                >
                  <span className={`row-method method-${result.endpoint.method}`}>
                    {result.endpoint.method}
                  </span>
                  <span className="palette-row-path">{result.endpoint.path}</span>
                  <span className="palette-verb">set live</span>
                  <span>{result.response}</span>
                  {/* So you don't "flip" something that was already flipped. */}
                  {isLive ? <span className="palette-live">live</span> : null}
                </button>
              )
            })
          )}
        </div>

        <div className="palette-footer">
          <span className="micro">↵ set live</span>
          <span className="micro">⌘↵ open detail</span>
          <span className="micro">esc close</span>
        </div>
      </div>
    </div>
  )
}
