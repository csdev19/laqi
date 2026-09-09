import { useEffect, useState } from 'react'
import { api } from '../api'
import { tokenizeTypeScript } from '../highlight'
import type { MockResponse } from '../types'

/**
 * What this response's shape actually is, on screen rather than only on the
 * clipboard.
 *
 * The panel always prints an export from a Shape, never a type definition
 * pasted by the developer. A stored recipe retains generation fidelity; a
 * hand-written body is inferred as a lossy fallback.
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
  const [derived, setDerived] = useState<{
    code: string
    origin: 'recipe' | 'body'
    warning?: string
  } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const recipe = props.response?.generatedFrom
  const code = derived?.code ?? null

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

  useEffect(() => {
    let cancelled = false
    setError(null)
    setDerived(null)
    api
      .getTypes(props.endpointId, { response: props.responseName, lang })
      .then((fetched) => {
        if (!cancelled) setDerived({ ...fetched, origin: fetched.origin ?? 'body' })
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
      })
    return () => {
      cancelled = true
    }
  }, [props.endpointId, props.responseName, props.revision, lang])

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

      <p className="types-origin">
        {derived?.origin === 'recipe' && recipe !== undefined
          ? `exported from Laqi’s ${recipe.typeName} generation recipe`
          : 'derived from the body'}
      </p>

      {error !== null ? <p className="form-error">{error}</p> : null}
      {derived?.warning ? <p className="form-error">{derived.warning}</p> : null}

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
