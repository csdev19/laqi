import { useLayoutEffect, useRef, type KeyboardEvent, type RefObject } from 'react'
import type { Token } from '../highlight'

/**
 * A transparent textarea on top of a colorized `<pre>`, with a line gutter
 * beside them, aligned character for character. That's all either editor
 * needs: the design explicitly calls for NOT bringing in a whole editor for
 * these surfaces.
 *
 * The textarea is the ONE scroller, and the other two layers are moved to
 * match it. It has to be that way round: a textarea scrolls itself to keep
 * the caret in view and nothing can talk it out of that, so a second
 * scroller over the same text drifts the moment the caret leaves the
 * visible area. Measured before this existed: typing at the end of a
 * 40-line body scrolled the field 2945px while the paint layer stayed at 0,
 * and the developer saw two different texts on top of each other.
 */
export function CodeSurface(props: {
  value: string
  onChange: (value: string) => void
  tokenize: (source: string) => Token[]
  /** What assistive technology calls the field. */
  label: string
  className?: string
  readOnly?: boolean
  placeholder?: string
  autoFocus?: boolean
  onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void
  /** Passed in when the caller drives the caret, as ModelEditor does. */
  textareaRef?: RefObject<HTMLTextAreaElement | null>
}) {
  const lines = props.value.split('\n')
  const own = useRef<HTMLTextAreaElement>(null)
  const input = props.textareaRef ?? own
  const paint = useRef<HTMLPreElement>(null)
  const gutter = useRef<HTMLDivElement>(null)

  const sync = () => {
    if (input.current) {
      mirrorScroll(input.current, { paint: paint.current, gutter: gutter.current })
    }
  }

  // An edit can move the field's scroll without a scroll event of its own —
  // deleting the last lines clamps it, for one — so the layers are squared
  // up after every render as well as on every scroll.
  useLayoutEffect(sync)

  return (
    <div className={props.className ? `editor-shell ${props.className}` : 'editor-shell'}>
      <div className="editor-gutter" aria-hidden="true" ref={gutter}>
        {lines.map((_, index) => (
          <div key={index}>{index + 1}</div>
        ))}
      </div>

      <div className="editor-area">
        <pre className="editor-paint" aria-hidden="true" ref={paint}>
          {props.tokenize(props.value).map((token, index) => (
            <span key={index} className={`tok-${token.kind}`}>
              {token.text}
            </span>
          ))}
          {/* An empty trailing line keeps the height when the source ends
              in \n, otherwise the caret ends up outside the painted area. */}
          {props.value.endsWith('\n') ? '\n' : ''}
        </pre>

        <textarea
          ref={input}
          className="editor-input mono"
          aria-label={props.label}
          placeholder={props.placeholder}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          autoFocus={props.autoFocus}
          readOnly={props.readOnly}
          value={props.value}
          onChange={(event) => props.onChange(event.target.value)}
          onKeyDown={props.onKeyDown}
          onScroll={sync}
        />
      </div>
    </div>
  )
}

/** Where the field has scrolled to, applied to the layers that mirror it. */
type Scrollable = { scrollTop: number; scrollLeft: number }

export function mirrorScroll(
  source: Scrollable,
  targets: { paint: Scrollable | null; gutter: Scrollable | null },
): void {
  if (targets.paint) {
    targets.paint.scrollTop = source.scrollTop
    targets.paint.scrollLeft = source.scrollLeft
  }
  // Vertically only: the gutter holds line numbers, and following the text
  // sideways would push them out of view.
  if (targets.gutter) targets.gutter.scrollTop = source.scrollTop
}
