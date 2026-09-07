import { checkJson, tokenizeJson } from '../highlight'
import { CodeSurface } from './CodeSurface'

/** The response body, colorized. The surface itself is CodeSurface. */
export function JsonEditor(props: {
  value: string
  onChange: (value: string) => void
  readOnly?: boolean
}) {
  return (
    <CodeSurface
      value={props.value}
      onChange={props.onChange}
      tokenize={tokenizeJson}
      label="response body"
      readOnly={props.readOnly}
    />
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
