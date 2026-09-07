import { useEffect, useState } from 'react'
import { api } from '../api'
import { tokenizeTypeScript } from '../highlight'
import type { MockResponse } from '../types'

/**
 * What this response's shape actually is, on screen rather than only on the
 * clipboard.
 *
 * Two sources, and the panel always says which one it is showing. A response
 * generated from a model carries that model, and that is the honest answer:
 * the whole file as pasted, every declaration, with the literal unions,
 * optional fields and tuples a body cannot carry. Anything else — a
 * hand-written response, a pasted JSON body, an endpoint from before any of
 * this existed — gets the types derived from the body it holds.
 *
 * Asking for a language other than TypeScript is asking for the derived
 * form: there is only one language the stored model could be in.
 */
export function TypesPanel(props: {
  endpointId: string
  responseName: string
  response: MockResponse | undefined
  /** Changes when the stored definition does, so derived types refetch. */
  revision: string
}) {
  const [lang, setLang] = useState('typescript')
  const [languages, setLanguages] = useState<{ name: string; displayName: string }[]>([
    { name: 'typescript', displayName: 'TypeScript' },
  ])
  const [derived, setDerived] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const model = props.response?.generatedFrom
  const showingModel = model !== undefined && lang === 'typescript'
  const code = showingModel ? model.model : derived

  useEffect(() => {
    let cancelled = false
    api
      .getLanguages()
      .then((all) => {
        if (!cancelled && all.length > 0) setLanguages(all)
      })
      .catch(() => {
        // The select keeps its one built-in option; the panel still works.
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Derived types are fetched only when they are what is on screen. A
  // response carrying a model does not pay for a round trip nobody reads.
  useEffect(() => {
    if (showingModel) return
    let cancelled = false
    setError(null)
    setDerived(null)
    api
      .getTypes(props.endpointId, { response: props.responseName, lang })
      .then(({ code: fetched }) => {
        if (!cancelled) setDerived(fetched)
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
      })
    return () => {
      cancelled = true
    }
  }, [props.endpointId, props.responseName, props.revision, lang, showingModel])

  return (
    <div className="meta-field types-panel">
      <span className="micro">types</span>

      <div className="detail-actions">
        <select
          className="meta-input"
          aria-label="types language"
          value={lang}
          onChange={(event) => setLang(event.target.value)}
        >
          {languages.map((language) => (
            <option key={language.name} value={language.name}>
              {language.displayName}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn"
          disabled={code === null}
          onClick={() => {
            if (code !== null) void navigator.clipboard?.writeText(code)
          }}
        >
          Copy types
        </button>
      </div>

      {/* Never ambiguous about what is on screen: one of these is the source
          the developer wrote, the other is a guess made from one sample. */}
      <p className="types-origin">
        {showingModel
          ? `the ${model.typeName} model this body was generated from`
          : model !== undefined
            ? 'derived from the body — the stored model is TypeScript'
            : 'derived from the body'}
      </p>

      {error !== null ? <p className="form-error">{error}</p> : null}

      <pre className="types-code mono" aria-label="types">
        {code === null
          ? 'reading…'
          : lang === 'typescript'
            ? tokenizeTypeScript(code).map((token, index) => (
                <span key={index} className={`tok-${token.kind}`}>
                  {token.text}
                </span>
              ))
            : code}
      </pre>
    </div>
  )
}
