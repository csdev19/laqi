import { checkJson, tokenizeJson } from '../highlight'

/**
 * A transparent textarea on top of a colorized <pre>, aligned character for
 * character. That's all it needs: the design explicitly calls for NOT
 * bringing in a whole editor for this surface.
 */
export function JsonEditor(props: {
  value: string
  onChange: (value: string) => void
  readOnly?: boolean
}) {
  const lines = props.value.split('\n')

  return (
    <div className="editor-shell">
      <div className="editor-gutter" aria-hidden="true">
        {lines.map((_, index) => (
          <div key={index}>{index + 1}</div>
        ))}
      </div>

      <div className="editor-area">
        <pre className="editor-paint" aria-hidden="true">
          {tokenizeJson(props.value).map((token, index) => (
            <span key={index} className={`tok-${token.kind}`}>
              {token.text}
            </span>
          ))}
          {/* An empty trailing line keeps the height when the source ends
              in \n, otherwise the caret ends up outside the painted area. */}
          {props.value.endsWith('\n') ? '\n' : ''}
        </pre>

        <textarea
          className="editor-input mono"
          aria-label="response body"
          spellCheck={false}
          readOnly={props.readOnly}
          value={props.value}
          onChange={(event) => props.onChange(event.target.value)}
        />
      </div>
    </div>
  )
}

export function ValidityReadout(props: { source: string }) {
  const check = checkJson(props.source)

  return check.valid ? (
    <span className="editor-validity">valid JSON · {check.bytes} B</span>
  ) : (
    <span className="editor-validity is-invalid">{check.message}</span>
  )
}
