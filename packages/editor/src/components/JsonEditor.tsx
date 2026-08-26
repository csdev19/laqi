import { checkJson, tokenizeJson } from '../highlight'

/**
 * Un textarea transparente encima de un <pre> coloreado, alineados carácter
 * a carácter. Es todo lo que hace falta: el diseño pide explícitamente NO
 * traer un editor entero para esta superficie.
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
          {/* Una línea final vacía mantiene la altura cuando el source
              termina en \n, si no el caret se sale del área pintada. */}
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
