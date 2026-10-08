import type { Diagnostic } from '@laqi/schema'
import { useEffect, useState } from 'react'
import { api } from '../api'
import { tokenizeTypeScript } from '../highlight'
import type { MockResponse } from '../types'

/**
 * What this response's shape actually is, on screen rather than only on the
 * clipboard.
 *
 * Two sources, and the panel always says which one it is showing, because
 * they are not equally trustworthy. A stored schema states what the response
 * may contain, in any language quicktype targets. A body is one sample, and
 * types inferred from it cannot show that a field was a literal union, that
 * an absent optional exists, or that an array had a fixed length.
 *
 * Whatever the schema had to approximate is shown here too, beside the types
 * rather than behind a click: it is the difference between what the source
 * said and what laqi can generate, and reading the types without it would be
 * reading half the answer.
 */
export function TypesPanel(props: {
  endpointId: string
  responseName: string
  response: MockResponse | undefined
  /** Changes when the stored definition does, so derived types refetch. */
  revision: string
  /** A draft-only response has no server-side shape to print yet. */
  unavailableReason?: string
}) {
  const [lang, setLang] = useState('typescript')
  const [languages, setLanguages] = useState<{ name: string; displayName: string }[]>([
    { name: 'typescript', displayName: 'TypeScript' },
  ])
  const [printed, setPrinted] = useState<{
    code: string
    origin: 'schema' | 'body'
    diagnostics?: Diagnostic[]
  } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const schema = props.response?.schema
  const code = printed?.code ?? null

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

  // The server prints, in every case. It is the side that knows whether the
  // stored schema was usable, so it is the side that decides the origin —
  // the panel reports that answer rather than guessing at it from the
  // response it happens to hold.
  useEffect(() => {
    let cancelled = false
    setError(null)
    setPrinted(null)
    if (props.unavailableReason !== undefined)
      return () => {
        cancelled = true
      }
    api
      .getTypes(props.endpointId, { response: props.responseName, lang })
      .then((fetched) => {
        if (!cancelled) setPrinted(fetched)
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
      })
    return () => {
      cancelled = true
    }
  }, [props.endpointId, props.responseName, props.revision, props.unavailableReason, lang])

  return (
    <div className="meta-field types-panel">
      <span className="micro">types</span>

      <div className="detail-actions">
        <select
          className="meta-input"
          aria-label="types language"
          value={lang}
          disabled={props.unavailableReason !== undefined}
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
          disabled={code === null || props.unavailableReason !== undefined}
          onClick={() => {
            if (code !== null) void navigator.clipboard?.writeText(code)
          }}
        >
          Copy types
        </button>
      </div>

      {/* Never ambiguous about what is on screen: one of these states what
          the response may contain, the other is a guess made from one sample. */}
      <p className="types-origin">
        {props.unavailableReason ??
          (printed?.origin === 'schema' && schema !== undefined
            ? `exported from the ${schema.name} schema this response carries`
            : 'derived from the body — this response carries no schema')}
      </p>

      {/* Where the model is shown is where someone wonders what to do with
          it. The action lives next to Regenerate, which is a column away,
          so this says it is there rather than leaving it to be found. */}
      {printed !== null && printed.origin === 'body' ? (
        <p className="types-origin">
          Build model, above, turns these types into a schema this response keeps.
        </p>
      ) : null}

      {/* What the source said that the schema could not keep. Shown next to
          the types, because copying them without knowing this is copying a
          claim laqi already knows is incomplete.

          The heading says the approximation was ACKNOWLEDGED, not merely
          detected: a stored loss is there because someone accepted it, and
          reading the list without that reads like an unfixed bug. */}
      {(printed?.diagnostics ?? []).some((item) => item.kind === 'loss') ? (
        <p className="types-origin types-acknowledged">approximation acknowledged</p>
      ) : null}
      {(printed?.diagnostics ?? []).map((item) => (
        <p key={`${item.code}${item.pointer}`} className="types-loss micro">
          {item.kind === 'loss' ? 'approximated' : 'note'}: {item.message}
        </p>
      ))}

      {error !== null ? <p className="form-error">{error}</p> : null}

      <pre className="types-code mono" aria-label="types">
        {props.unavailableReason !== undefined
          ? 'save the endpoint to print types'
          : code === null
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
